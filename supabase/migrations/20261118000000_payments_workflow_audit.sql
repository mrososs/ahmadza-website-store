-- AAWRAQ platform — migration 19: payment-gateway hardening, catalogue workflow status, evidence-based recovered drafts, download audit.
-- Depends on migration 18. NOT applied to the hosted project without the owner's approval.

-- ===========================================================================
-- 1. Payments: bind a gateway callback to the gateway-signed order id, and keep money that arrives late visible
-- ===========================================================================
-- Paymob's HMAC does not cover our merchant reference, so a valid signed callback could otherwise be replayed against a different payment.
-- The gateway's own order / charge id IS signed (Paymob: order.id) or fetched from the gateway API (Tap: chg_…). We store it when the session is
-- created and require callbacks to match BOTH the reference and that id.
alter table public.payments
  add column provider_order_id  text,
  add column needs_review       boolean     not null default false,
  add column review_reason      text,
  add column review_flagged_at  timestamptz;

create unique index payments_provider_order_uniq on public.payments (provider, provider_order_id) where provider_order_id is not null;
create index payments_needs_review_idx on public.payments (created_at desc) where needs_review;

create or replace function public.attach_provider_session(p_payment_id uuid, p_provider_order_id text) returns void
language sql security definer set search_path = '' as $$
  update public.payments set provider_order_id = p_provider_order_id
   where id = p_payment_id and status = 'pending' and order_id is null and provider_order_id is null;
$$;

-- Strict lookup for a callback: the gateway order id (signed by the gateway or fetched from its API) must match the row of the same provider.
-- When the callback also carries our reference it must match as well; a callback without one is still resolved by the signed order id alone.
create or replace function public.find_payment_for_callback(p_provider text, p_reference uuid, p_provider_order_id text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.payments
   where provider = p_provider and provider_order_id is not null and provider_order_id = p_provider_order_id
     and (p_reference is null or reference = p_reference)
$$;

-- Money was captured by the gateway but the payment can no longer be fulfilled automatically (already failed / expired / mismatch):
-- never lose it silently, surface it to the admin.
create or replace function public.flag_payment_review(p_payment_id uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.payments set needs_review = true, review_reason = left(p_reason, 300), review_flagged_at = coalesce(review_flagged_at, now())
   where id = p_payment_id;
$$;

revoke all on function public.attach_provider_session(uuid, text)               from public, anon, authenticated;
revoke all on function public.find_payment_for_callback(text, uuid, text)      from public, anon, authenticated;
revoke all on function public.flag_payment_review(uuid, text)                  from public, anon, authenticated;
grant execute on function public.attach_provider_session(uuid, text)            to service_role;
grant execute on function public.find_payment_for_callback(text, uuid, text)    to service_role;
grant execute on function public.flag_payment_review(uuid, text)                to service_role;

-- ===========================================================================
-- 2. Recovered-from-evidence drafts (e.g. a genuine PDF whose title page identifies the book, but whose price and original record are unknown)
-- ===========================================================================
alter table public.books drop constraint books_provenance_check;
alter table public.books add constraint books_provenance_check check (provenance in ('admin', 'legacy', 'demo', 'recovered_media'));
alter table public.books add column recovery_evidence jsonb;
comment on column public.books.recovery_evidence is
  'For provenance recovered_media: what identified the book (file checksum, PDF metadata, source), never a price. Admin review is required before publication.';

-- Readiness: recovered_media drafts need the same owner verification as legacy ones, plus recorded evidence; they have no original status or legacy id.
create or replace function public.book_readiness_row(b public.books) returns text[]
language plpgsql stable set search_path = '' as $$
declare r text[] := '{}';
begin
  if b.provenance = 'legacy' then
    if b.legacy_id is null then r := r || 'missing_legacy_id'::text; end if;
    if b.legacy_verified_at is null then r := r || 'source_not_verified'::text; end if;
    if b.legacy_status_raw is null then r := r || 'legacy_status_unknown'::text;
    elsif b.legacy_status_raw not in ('1', '2') then r := r || 'legacy_status_not_publishable'::text; end if;
  elsif b.provenance = 'recovered_media' then
    if b.recovery_evidence is null then r := r || 'missing_recovery_evidence'::text; end if;
    if b.legacy_verified_at is null then r := r || 'source_not_verified'::text; end if;
  end if;
  if b.title is null or btrim(b.title) = '' then r := r || 'missing_title'::text; end if;
  if b.kind = 'paid' and not (coalesce(b.price_amount, 0) > 0) then
    r := r || case when b.legacy_cost_raw is null then 'price_missing' else 'price_unparsable_or_zero' end;
  end if;
  if b.kind = 'free' and coalesce(b.price_amount, 0) <> 0 then r := r || 'free_book_with_price'::text; end if;
  if not exists (select 1 from public.book_media m
                  where m.book_id = b.id
                    and (b.provenance <> 'legacy' or m.legacy_book_media_id is not null)
                    and public.book_media_is_validated(m)) then
    r := r || 'no_validated_media'::text;
  end if;
  return r;
end $$;

create or replace function public.books_publication_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text[];
begin
  if new.provenance in ('legacy', 'recovered_media') and new.status in ('published', 'coming_soon') and new.deleted_at is null
     and ( tg_op = 'INSERT'
           or old.status is distinct from new.status or old.kind is distinct from new.kind or old.price_amount is distinct from new.price_amount
           or old.provenance is distinct from new.provenance or old.legacy_verified_at is distinct from new.legacy_verified_at
           or old.legacy_status_raw is distinct from new.legacy_status_raw or old.deleted_at is distinct from new.deleted_at ) then
    r := public.book_readiness_row(new);
    if coalesce(array_length(r, 1), 0) > 0 then
      raise exception 'book_not_eligible: %', array_to_string(r, ',') using errcode = 'AW001', hint = 'recovered books stay drafts until verified and complete';
    end if;
  end if;
  return new;
end $$;

create or replace function public.book_media_demote_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_book bigint := coalesce(old.book_id, new.book_id); b public.books%rowtype;
begin
  select * into b from public.books where id = v_book;
  if found and b.provenance in ('legacy', 'recovered_media') and b.status in ('published', 'coming_soon')
     and 'no_validated_media' = any (public.book_readiness_row(b)) then
    update public.books set status = 'draft' where id = v_book;
  end if;
  return coalesce(new, old);
end $$;

-- Owner review of ONE book (the whole-run verification stays available): "I have looked at this record and the evidence is genuine".
create or replace function public.verify_book(p_book bigint, p_admin uuid) returns boolean
language sql security definer set search_path = '' as $$
  with u as (
    update public.books set legacy_verified_at = coalesce(legacy_verified_at, now()), legacy_verified_by = coalesce(legacy_verified_by, p_admin)
     where id = p_book and provenance in ('legacy', 'recovered_media') and deleted_at is null
    returning 1)
  select exists (select 1 from u)
$$;
revoke all on function public.verify_book(bigint, uuid) from public, anon, authenticated;
grant execute on function public.verify_book(bigint, uuid) to service_role;

-- ===========================================================================
-- 3. Catalogue workflow status: Draft / Needs review / Missing media / Ready for publication / Published / Archived
-- ===========================================================================
create or replace function public.book_workflow_status(b public.books, r text[]) returns text
language sql immutable set search_path = '' as $$
  select case
    when b.deleted_at is not null or b.status = 'archived' then 'archived'
    when b.status in ('published', 'coming_soon')           then 'published'
    when coalesce(array_length(r, 1), 0) = 0                then 'ready'
    when b.provenance in ('admin', 'demo')                  then 'draft'
    when r <@ array['no_validated_media']::text[]           then 'missing_media'
    else 'needs_review'
  end
$$;
revoke all on function public.book_workflow_status(public.books, text[]) from public, anon, authenticated;
grant execute on function public.book_workflow_status(public.books, text[]) to service_role;

create or replace view public.books_readiness with (security_invoker = true) as
select b.id as book_id, b.legacy_id, b.provenance, b.status, b.kind, b.price_amount, b.legacy_cost_raw, b.legacy_status_raw,
       b.legacy_verified_at, b.import_run_id, b.title, b.cover_path, r.reasons,
       coalesce(array_length(r.reasons, 1), 0) = 0 as eligible,
       (select count(*) from public.book_media m where m.book_id = b.id)                                          as media_total,
       (select count(*) from public.book_media m where m.book_id = b.id and public.book_media_is_validated(m))    as media_validated,
       (select count(*) from public.book_media m where m.book_id = b.id and m.migration_status in ('pending', 'missing', 'rejected')) as media_missing,
       public.book_workflow_status(b, r.reasons) as workflow_status
  from public.books b
 cross join lateral (select public.book_readiness_row(b) as reasons) r
 where b.deleted_at is null;
revoke all on public.books_readiness from public, anon, authenticated;
grant select on public.books_readiness to service_role;

-- ===========================================================================
-- 4. Download audit log (who asked for which file, and what happened). No IP address, no file path.
-- ===========================================================================
create table public.media_download_log (
  id         bigint generated always as identity primary key,
  media_id   bigint references public.book_media (id) on delete set null,
  book_id    bigint references public.books (id) on delete set null,
  user_id    uuid   references public.profiles (id) on delete set null,
  outcome    text   not null check (outcome in ('granted', 'denied_login', 'denied_purchase', 'unavailable', 'not_found', 'invalid_source')),
  reason     text,
  created_at timestamptz not null default now()
);
create index media_download_log_media_idx on public.media_download_log (media_id, created_at desc);
create index media_download_log_book_idx  on public.media_download_log (book_id) where book_id is not null;
create index media_download_log_user_idx  on public.media_download_log (user_id) where user_id is not null;
create index media_download_log_time_idx  on public.media_download_log (created_at desc);
alter table public.media_download_log enable row level security;
-- Supabase's default privileges hand anon/authenticated every right on a new public table, and TRUNCATE is not subject to row-level security:
-- take them all back, then grant only what is intended (admins read through the policy below; everything else goes through the server).
revoke all on public.media_download_log from public, anon, authenticated;
revoke all on sequence public.media_download_log_id_seq from public, anon, authenticated;
grant select on public.media_download_log to authenticated;
create policy media_download_log_admin_read on public.media_download_log for select to authenticated using ((select public.is_admin()));

create or replace function public.log_media_download(p_media bigint, p_book bigint, p_user uuid, p_outcome text, p_reason text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.media_download_log (media_id, book_id, user_id, outcome, reason) values (p_media, p_book, p_user, p_outcome, left(p_reason, 200));
$$;
revoke all on function public.log_media_download(bigint, bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.log_media_download(bigint, bigint, uuid, text, text) to service_role;

-- ===========================================================================
-- 5. Free-book access: a distinct, verified path with NO order and NO payment record
-- ===========================================================================
-- A purchase creates an entitlement through fulfill_payment (source 'purchase'). A free book is claimed through claim_free_book (source 'free_claim'):
-- it validates the book is published, genuinely free (kind free, price 0) and not deleted, and the account is active. It never creates an order,
-- a payment, an invoice or a commission, and an administrator's revocation is never undone by claiming again.
alter table public.entitlements add column source text not null default 'purchase' check (source in ('purchase', 'free_claim'));

create or replace function public.claim_free_book(p_user uuid, p_book bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles; v_book public.books; v_id bigint;
begin
  select * into v_profile from public.profiles where id = p_user and deleted_at is null;
  if not found then raise exception 'unknown user' using errcode = 'P0002'; end if;
  if v_profile.status <> 'active' then raise exception 'account is not allowed (status=%)', v_profile.status using errcode = '42501'; end if;
  select * into v_book from public.books where id = p_book and deleted_at is null;
  if not found or v_book.status <> 'published' or v_book.kind <> 'free' or coalesce(v_book.price_amount, 0) <> 0 then
    raise exception 'book is not available as a free book' using errcode = '22023';
  end if;
  insert into public.entitlements (user_id, book_id, order_item_id, is_test, source) values (p_user, p_book, null, false, 'free_claim')
  on conflict (user_id, book_id) do nothing
  returning id into v_id;
  return v_id is not null; -- false: already in the library (or deliberately revoked by an administrator)
end $$;
revoke all on function public.claim_free_book(uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_free_book(uuid, bigint) to service_role;
