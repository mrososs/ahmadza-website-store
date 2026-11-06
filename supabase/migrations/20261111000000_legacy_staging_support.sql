-- Historical media staging support (fork E). Additive only.
-- The private `legacy-staging` bucket holds recovered, scanned, content-addressed files that are NOT yet attached to a book.
-- It has no Data API policy: only the service role (import scripts) and signed URLs can reach it.
update storage.buckets
   set allowed_mime_types = array['application/pdf','audio/mpeg','image/png','image/jpeg','image/gif','image/webp','video/mp4'],
       public = false
 where id = 'legacy-staging';

alter table public.legacy_media_staging
  add column if not exists scope      text,
  add column if not exists mime_type  text,
  add column if not exists scanned_at timestamptz,
  add column if not exists av_result  text;

comment on table public.legacy_media_staging is
  'Inventory of recovered legacy media. Orphans (no book mapping) stay here, quarantined and private, never published.';
