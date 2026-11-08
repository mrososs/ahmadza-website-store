-- Legacy article recovery: additive provenance columns only. Nothing is dropped or rewritten.
-- Articles recovered from secondary evidence (archived pages) always enter as status 'draft'.

alter table public.articles
  add column if not exists original_slug   text,
  add column if not exists legacy_refs     text[] not null default '{}',   -- every legacy id / token / URL path seen for the article
  add column if not exists content_sha256  text,
  add column if not exists source_system   text,                           -- e.g. 'internet-archive'
  add column if not exists source_evidence jsonb,                          -- captures, confidence, missing fields (admin only)
  add column if not exists review_status   text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'approved', 'rejected'));

create unique index if not exists articles_content_sha256_uidx on public.articles (content_sha256) where content_sha256 is not null;
create index if not exists articles_legacy_refs_gin on public.articles using gin (legacy_refs);

-- Provenance columns are not in the public column grant (anon/authenticated cannot read them). Publication stays gated by status = 'published' (policies articles_read_anon / articles_read_auth).

-- Resolve a legacy id / token to the new article id (public: returns an id only for published articles).
create or replace function public.resolve_legacy_article(p_ref text)
returns bigint
language sql stable security definer set search_path = public
as $$
  select a.id from public.articles a
  where a.status = 'published' and a.deleted_at is null and (p_ref = any (a.legacy_refs) or a.legacy_id::text = p_ref)
  limit 1
$$;
revoke all on function public.resolve_legacy_article(text) from public;
grant execute on function public.resolve_legacy_article(text) to anon, authenticated;
