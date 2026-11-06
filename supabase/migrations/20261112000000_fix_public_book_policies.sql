-- Fix: RLS policies on book link tables / book_media sub-selected public.books.deleted_at with the CALLER's
-- privileges. anon/authenticated have no column grant on deleted_at (deliberately), so every read of
-- book_categories / book_makers / book_tags / book_relations / book_media failed with
-- "permission denied for table books". A SECURITY DEFINER predicate evaluates visibility without widening grants.
-- Found by tests/db/rls.test.ts.

create or replace function public.is_public_book(p_book bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.books b
                  where b.id = p_book and b.status in ('published', 'coming_soon') and b.deleted_at is null)
$$;
revoke all on function public.is_public_book(bigint) from public;
grant execute on function public.is_public_book(bigint) to anon, authenticated, service_role;

drop policy if exists book_categories_read on public.book_categories;
drop policy if exists book_makers_read     on public.book_makers;
drop policy if exists book_tags_read       on public.book_tags;
drop policy if exists book_relations_read  on public.book_relations;
drop policy if exists book_media_read      on public.book_media;

create policy book_categories_read on public.book_categories for select to anon, authenticated using (public.is_public_book(book_id));
create policy book_makers_read     on public.book_makers     for select to anon, authenticated using (public.is_public_book(book_id));
create policy book_tags_read       on public.book_tags       for select to anon, authenticated using (public.is_public_book(book_id));
create policy book_relations_read  on public.book_relations  for select to anon, authenticated using (public.is_public_book(book_id));
create policy book_media_read      on public.book_media      for select to anon, authenticated using (public.is_public_book(book_id));
