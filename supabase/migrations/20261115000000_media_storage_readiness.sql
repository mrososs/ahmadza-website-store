-- Media storage readiness: book_media can describe a file that physically lives in ANY backend (Supabase Storage today,
-- the client's VPS later, or an external https link) and records whether the physical file has been migrated yet.
-- Business model is unchanged: metadata + entitlement live here; bytes live in the storage backend; authorisation is
-- decided by trusted Nuxt server code (server/services/storage).
--
-- Column map for the VPS phase (see docs/implementation/VPS_STORAGE_INTEGRATION_PLAN.md):
--   storage_provider   where the bytes are            ('none' | 'supabase' | 'vps' | 'external')
--   storage_path       the provider-relative OBJECT KEY (e.g. books/<book_id>/<uuid>.pdf) — never a user-controlled filesystem path
--   sha256 / byte_size / mime_type   verified content facts (checksum is verified against the legacy manifest before 'available')
--   legacy_path / legacy_book_media_id   original Laravel location and id
--   migration_status   pending -> staged -> available | missing | rejected
--   is_external / external_url   kept for compatibility; is_external <=> storage_provider = 'external'

create type public.media_storage_provider as enum ('none', 'supabase', 'vps', 'external');
create type public.media_migration_status as enum ('pending', 'staged', 'available', 'missing', 'rejected');

alter table public.book_media
  add column storage_provider    public.media_storage_provider not null default 'none',
  add column migration_status    public.media_migration_status not null default 'pending',
  add column checksum_verified_at timestamptz;

comment on column public.book_media.storage_path is 'Provider-relative object key. Never exposed through the Data API; resolved only by trusted server code.';
comment on column public.book_media.storage_provider is 'Which backend holds the bytes. ''none'' = metadata placeholder, file not migrated yet.';
comment on column public.book_media.migration_status is 'pending = no file yet; staged = file exists but not verified/linked; available = verified and downloadable; missing/rejected = reported, never served.';

-- backfill existing rows (development data only today)
update public.book_media set storage_provider = 'external', migration_status = 'available' where is_external and external_url is not null;
update public.book_media set storage_provider = 'supabase', migration_status = 'available' where not is_external and storage_path is not null;

-- Keep every existing insert path working: derive provider/status from what a caller supplied.
create or replace function public.book_media_normalize() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_external or new.storage_provider = 'external' then
    new.is_external := true;
    new.storage_provider := 'external';
    new.storage_path := null;
    if new.migration_status = 'pending' and new.external_url is not null then new.migration_status := 'available'; end if;
  else
    new.is_external := false;
    if new.storage_provider = 'none' and new.storage_path is not null then new.storage_provider := 'supabase'; end if;
    if new.storage_provider = 'supabase' and new.migration_status = 'pending' and new.storage_path is not null then
      new.migration_status := 'available';
    end if;
  end if;
  -- a row can only be 'available' when it points at something
  if new.migration_status = 'available' and new.storage_path is null and new.external_url is null then
    new.migration_status := 'pending';
  end if;
  return new;
end $$;
create trigger book_media_normalize before insert or update on public.book_media
  for each row execute function public.book_media_normalize();

alter table public.book_media drop constraint if exists book_media_source;
alter table public.book_media add constraint book_media_source check (
     (storage_provider = 'external' and is_external and external_url is not null and storage_path is null)
  or (storage_provider in ('supabase', 'vps') and not is_external and storage_path is not null)
  or (storage_provider = 'none' and not is_external and storage_path is null and external_url is null)
);
alter table public.book_media add constraint book_media_available_has_source check (
  migration_status <> 'available' or storage_path is not null or external_url is not null
);
alter table public.book_media add constraint book_media_sha256_format check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
alter table public.book_media add constraint book_media_size_nonneg check (byte_size is null or byte_size >= 0);

-- A given physical object may be referenced once per provider (legacy duplicates share bytes through separate rows,
-- so uniqueness is on (provider, key) only for rows that own a key).
create index if not exists book_media_provider_status_idx on public.book_media (storage_provider, migration_status);
create index if not exists book_media_sha256_idx on public.book_media (sha256) where sha256 is not null;

-- Public (Data API) visibility: the UI may know whether a file is downloadable yet, never where it is.
grant select (migration_status) on public.book_media to anon, authenticated;
revoke execute on function public.book_media_normalize() from public, anon, authenticated;
