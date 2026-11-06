-- Slice B: small trusted helper for the download counter (service_role only).
create or replace function public.increment_media_download(p_media bigint) returns void
language sql security definer set search_path = '' as $$
  update public.book_media set legacy_download_count = coalesce(legacy_download_count, 0) + 1 where id = p_media;
$$;
revoke all on function public.increment_media_download(bigint) from public, anon, authenticated;
grant execute on function public.increment_media_download(bigint) to service_role;
