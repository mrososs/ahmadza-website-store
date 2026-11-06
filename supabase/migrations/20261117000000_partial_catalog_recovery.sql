-- AAWRAQ platform — migration 18: partial-catalogue recovery.
-- Recovered (legacy) books are imported as DRAFTS and can only become published when they are verified and complete.
-- The rule is enforced here, in the database, so no API route or admin action can publish an ineligible recovered book.
--
-- A recovered book is eligible for publication only when ALL of these hold (reasons are explicit, see book_readiness_row):
--   * its source is verified as genuine legacy data      (legacy_id present AND legacy_verified_at set by an owner-approved verification)
--   * its ORIGINAL publication status is known and publishable (legacy_status_raw is '1' published or '2' coming soon)
--   * its price is valid: paid > 0, or genuinely free = 0   (an unparsable price keeps the raw string and a 0.00 placeholder: never published)
--   * its media relationship is verified                  (the media row came from a legacy book_media row)
--   * at least one media file is available AND passed validation (hash recorded; antivirus-clean quarantine scan, or checksum re-verified)
-- Nothing here enables checkout: publication only makes the catalogue record visible.

-- ---------------------------------------------------------------------------
-- Provenance of every book
-- ---------------------------------------------------------------------------
alter table public.books
  add column provenance          text        not null default 'admin' check (provenance in ('admin', 'legacy', 'demo')),
  add column legacy_status_raw   text,
  add column legacy_verified_at  timestamptz,
  add column legacy_verified_by  uuid        references public.profiles (id) on delete set null,
  add column import_run_id       bigint      references public.migration_runs (id) on delete set null;

comment on column public.books.provenance is 'admin = created in the admin UI; legacy = recovered from the legacy database; demo = development seed.';
comment on column public.books.legacy_status_raw is 'The ORIGINAL legacy status value, verbatim (1 published, 2 coming soon, 0 draft…). Never rewritten; promotion reads it.';
comment on column public.books.legacy_verified_at is 'Set only by an owner-approved verification of the import run (verify_legacy_run). NULL = source not verified.';

update public.books set provenance = 'demo' where is_demo;
create index books_import_run_idx on public.books (import_run_id) where import_run_id is not null;
create index books_legacy_verified_by_idx on public.books (legacy_verified_by) where legacy_verified_by is not null;

-- ---------------------------------------------------------------------------
-- Media validation
-- ---------------------------------------------------------------------------
-- A file counts as validated when it is available, stored (not an external link we cannot vouch for), hashed, and either
-- re-verified (checksum_verified_at) or backed by a quarantine record that the antivirus scan passed for the same hash.
create or replace function public.book_media_is_validated(m public.book_media) returns boolean
language sql stable set search_path = '' as $$
  select m.migration_status = 'available'
     and not m.is_external
     and m.storage_path is not null
     and m.sha256 is not null
     and ( m.checksum_verified_at is not null
           or exists (select 1 from public.legacy_media_staging s
                       where s.book_media_id = m.id and s.sha256 = m.sha256 and s.scanned_at is not null and s.av_result = 'clean') )
$$;

-- ---------------------------------------------------------------------------
-- Readiness: the explicit reasons a book cannot be published (empty array = eligible)
-- ---------------------------------------------------------------------------
create or replace function public.book_readiness_row(b public.books) returns text[]
language plpgsql stable set search_path = '' as $$
declare r text[] := '{}';
begin
  if b.provenance = 'legacy' then
    if b.legacy_id is null then r := r || 'missing_legacy_id'::text; end if;
    if b.legacy_verified_at is null then r := r || 'source_not_verified'::text; end if;
    if b.legacy_status_raw is null then r := r || 'legacy_status_unknown'::text;
    elsif b.legacy_status_raw not in ('1', '2') then r := r || 'legacy_status_not_publishable'::text; end if;
  end if;
  if b.title is null or btrim(b.title) = '' then r := r || 'missing_title'::text; end if;
  if b.kind = 'paid' and not (coalesce(b.price_amount, 0) > 0) then
    r := r || case when b.legacy_cost_raw is null then 'price_missing' else 'price_unparsable_or_zero' end;
  end if;
  if b.kind = 'free' and coalesce(b.price_amount, 0) <> 0 then r := r || 'free_book_with_price'::text; end if;
  if not exists (select 1 from public.book_media m
                  where m.book_id = b.id
                    and (b.provenance <> 'legacy' or m.legacy_book_media_id is not null)   -- relationship verified: the row came from a legacy book_media record
                    and public.book_media_is_validated(m)) then
    r := r || 'no_validated_media'::text;
  end if;
  return r;
end $$;

create or replace function public.book_readiness(p_book bigint) returns table (eligible boolean, reasons text[])
language plpgsql stable set search_path = '' as $$
declare b public.books%rowtype; r text[];
begin
  select * into b from public.books where id = p_book;
  if not found then return query select false, array['book_not_found']::text[]; return; end if;
  r := public.book_readiness_row(b);
  return query select coalesce(array_length(r, 1), 0) = 0, r;
end $$;

-- ---------------------------------------------------------------------------
-- The guard: a recovered book cannot be published unless it is eligible
-- ---------------------------------------------------------------------------
create or replace function public.books_publication_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text[];
begin
  if new.provenance = 'legacy' and new.status in ('published', 'coming_soon') and new.deleted_at is null
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
create trigger books_publication_guard before insert or update on public.books for each row execute function public.books_publication_guard();

-- A published recovered book whose LAST validated media disappears (deleted, rejected, un-verified) drops back to draft.
create or replace function public.book_media_demote_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_book bigint := coalesce(old.book_id, new.book_id); b public.books%rowtype;
begin
  select * into b from public.books where id = v_book;
  if found and b.provenance = 'legacy' and b.status in ('published', 'coming_soon')
     and 'no_validated_media' = any (public.book_readiness_row(b)) then
    update public.books set status = 'draft' where id = v_book;
  end if;
  return coalesce(new, old);
end $$;
create trigger book_media_demote_guard after update or delete on public.book_media for each row execute function public.book_media_demote_guard();

-- ---------------------------------------------------------------------------
-- Admin reporting view (server only)
-- ---------------------------------------------------------------------------
create view public.books_readiness with (security_invoker = true) as
select b.id as book_id, b.legacy_id, b.provenance, b.status, b.kind, b.price_amount, b.legacy_cost_raw, b.legacy_status_raw,
       b.legacy_verified_at, b.import_run_id, b.title, b.cover_path, r.reasons,
       coalesce(array_length(r.reasons, 1), 0) = 0 as eligible,
       (select count(*) from public.book_media m where m.book_id = b.id)                                          as media_total,
       (select count(*) from public.book_media m where m.book_id = b.id and public.book_media_is_validated(m))    as media_validated,
       (select count(*) from public.book_media m where m.book_id = b.id and m.migration_status in ('pending', 'missing', 'rejected')) as media_missing
  from public.books b
 cross join lateral (select public.book_readiness_row(b) as reasons) r
 where b.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Owner-approved verification and conservative promotion (server only)
-- ---------------------------------------------------------------------------
create or replace function public.verify_legacy_run(p_run bigint, p_admin uuid) returns integer
language sql security definer set search_path = '' as $$
  with u as (
    update public.books set legacy_verified_at = now(), legacy_verified_by = p_admin
     where provenance = 'legacy' and import_run_id = p_run and legacy_verified_at is null
    returning 1)
  select count(*)::integer from u
$$;

-- Promotes ONLY drafts that are eligible, to their ORIGINAL legacy status (1 -> published, 2 -> coming_soon). Everything else is untouched.
create or replace function public.promote_eligible_books(p_run bigint default null) returns table (book_id bigint, new_status public.content_status)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with c as (
    select b.id, case b.legacy_status_raw when '1' then 'published'::public.content_status when '2' then 'coming_soon'::public.content_status end as ns
      from public.books b
     where b.provenance = 'legacy' and b.status = 'draft' and b.deleted_at is null
       and (p_run is null or b.import_run_id = p_run)
       and coalesce(array_length(public.book_readiness_row(b), 1), 0) = 0),
  u as (
    update public.books b set status = c.ns from c where b.id = c.id and c.ns is not null returning b.id, b.status)
  select u.id, u.status from u;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: none of this is callable from the browser
-- ---------------------------------------------------------------------------
revoke all on function public.book_media_is_validated(public.book_media) from public, anon, authenticated;
revoke all on function public.book_readiness_row(public.books)            from public, anon, authenticated;
revoke all on function public.book_readiness(bigint)                      from public, anon, authenticated;
revoke all on function public.books_publication_guard()                   from public, anon, authenticated;
revoke all on function public.book_media_demote_guard()                   from public, anon, authenticated;
revoke all on function public.verify_legacy_run(bigint, uuid)             from public, anon, authenticated;
revoke all on function public.promote_eligible_books(bigint)              from public, anon, authenticated;
grant execute on function public.book_media_is_validated(public.book_media) to service_role;
grant execute on function public.book_readiness_row(public.books)           to service_role;
grant execute on function public.book_readiness(bigint)                     to service_role;
grant execute on function public.verify_legacy_run(bigint, uuid)            to service_role;
grant execute on function public.promote_eligible_books(bigint)             to service_role;
revoke all on public.books_readiness from public, anon, authenticated;
grant select on public.books_readiness to service_role;

-- Per-file validation status for the admin recovery panel (server only)
create view public.book_media_readiness with (security_invoker = true) as
select m.id as media_id, m.book_id, m.name, m.kind, m.visibility, m.migration_status, m.storage_provider, m.is_external,
       m.legacy_book_media_id, m.legacy_path, (m.sha256 is not null) as has_hash, m.checksum_verified_at,
       public.book_media_is_validated(m) as validated
  from public.book_media m;
revoke all on public.book_media_readiness from public, anon, authenticated;
grant select on public.book_media_readiness to service_role;
