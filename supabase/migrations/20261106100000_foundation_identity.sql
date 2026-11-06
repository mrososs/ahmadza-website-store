-- AAWRAQ platform — migration 1: extensions, enums, identity, roles, audit.
-- Local-only workflow (supabase db reset). Never run against a hosted project from this repository.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enumerations (replace the legacy "magic integer" columns, see docs/legacy-audit/08)
-- ---------------------------------------------------------------------------
create type public.app_role           as enum ('admin');
create type public.account_status     as enum ('active', 'review', 'banned');            -- legacy users.status 1/0/2
create type public.content_status     as enum ('draft', 'published', 'coming_soon', 'archived'); -- legacy 0/1/2 (+ soft delete)
create type public.book_kind          as enum ('paid', 'free');
create type public.maker_kind         as enum ('author', 'reader', 'writer');
create type public.maker_era          as enum ('old', 'new');
create type public.media_kind         as enum ('file', 'audio');
create type public.media_visibility   as enum ('preview', 'after_purchase');              -- legacy is_free 0,2 -> preview ; 1 -> after_purchase
create type public.data_mode          as enum ('live', 'test');
create type public.order_status       as enum ('paid', 'failed', 'refunded');
create type public.payment_status     as enum ('pending', 'succeeded', 'failed', 'cancelled', 'expired');
create type public.ledger_entry_type  as enum ('commission', 'withdrawal_hold', 'withdrawal_release', 'adjustment', 'reversal');
create type public.withdrawal_status  as enum ('pending', 'paid', 'rejected');
create type public.contributor_deal   as enum ('share', 'rent');
create type public.contributor_status as enum ('pending', 'approved', 'declined');
create type public.article_kind       as enum ('article', 'video', 'ads');
create type public.comment_status     as enum ('pending', 'approved', 'rejected');
create type public.staging_status     as enum ('inventoried', 'quarantined', 'staged', 'linked', 'missing', 'rejected');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Arabic-aware normalisation used for search (same rules as shared/utils/arabic.ts).
create or replace function public.normalize_ar(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(
    translate(
      regexp_replace(coalesce(p, ''), '[ً-ٰٟـ]', '', 'g'),  -- tashkeel + tatweel
      'إأآىة',
      chr(1575) || chr(1575) || chr(1575) || chr(1610) || chr(1607)   -- ا ا ا ي ه
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Site settings (singleton) — created here because is_admin() reads it.
-- Unconfirmed commercial values are flagged in pending_owner_confirmation (docs/legacy-audit/16).
-- ---------------------------------------------------------------------------
create table public.site_settings (
  id                    smallint primary key default 1 check (id = 1),
  site_name             text    not null default 'أوراق عربية',
  phone                 text,
  email                 text,
  description           text,
  keywords              text,
  facebook text, twitter text, instagram text, youtube text, telegram text, linkedin text, whatsapp text, broadcast text,
  logo_path             text,
  poster_path           text,
  poster_mobile_path    text,
  show_poster_desktop   boolean not null default false,
  show_poster_mobile    boolean not null default false,
  show_free_book_button boolean not null default true,
  -- commercial parameters: legacy migration defaults, NOT confirmed live values
  affiliate_commission_percent numeric(5,2)  not null default 10   check (affiliate_commission_percent between 0 and 100),
  commission_freeze_days       integer       not null default 30   check (commission_freeze_days >= 0),
  min_withdrawal_amount        numeric(12,2) not null default 100  check (min_withdrawal_amount >= 0),
  base_currency                char(3)       not null default 'USD',
  payment_mode                 public.data_mode not null default 'test',
  allow_test_payments          boolean       not null default false,  -- local dev simulation only
  require_admin_mfa            boolean       not null default false,
  pending_owner_confirmation   text[]        not null default array['affiliate_commission_percent','commission_freeze_days','min_withdrawal_amount','gateway','fx_rate'],
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);

insert into public.site_settings (id) values (1);

-- ---------------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,
  display_name            text not null default '',
  phone                   text,
  country                 text,
  country_code            text,
  region                  text,
  status                  public.account_status not null default 'active',
  is_affiliate            boolean not null default false,
  require_password_reset  boolean not null default false,
  legacy_user_id          bigint unique,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Roles are database-managed; user_metadata is never an authorisation source.
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- SECURITY DEFINER so RLS policies can call it without granting table access.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.user_roles r
            where r.user_id = (select auth.uid()) and r.role = 'admin'
         )
     and ( not coalesce((select s.require_admin_mfa from public.site_settings s where s.id = 1), false)
           or coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' )
$$;

-- New auth user -> profile. Only non-privileged display data is read from user metadata.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1)), 120))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Audit log (sensitive administrative actions). Written by triggers and server routes only.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  diff       jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_created_idx on public.audit_log (created_at desc);

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id text;
  v_diff jsonb;
begin
  if tg_op = 'DELETE' then
    v_id := (to_jsonb(old) ->> 'id');
    v_diff := jsonb_build_object('old', to_jsonb(old));
  elsif tg_op = 'UPDATE' then
    v_id := (to_jsonb(new) ->> 'id');
    v_diff := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
  else
    v_id := (to_jsonb(new) ->> 'id');
    v_diff := jsonb_build_object('new', to_jsonb(new));
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, diff)
  values ((select auth.uid()), lower(tg_op), tg_table_name, v_id, v_diff);
  return coalesce(new, old);
end $$;

create trigger audit_site_settings after insert or update or delete on public.site_settings
  for each row execute function public.audit_row_change();
create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change();
