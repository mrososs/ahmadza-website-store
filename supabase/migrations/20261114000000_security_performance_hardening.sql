-- Security & performance hardening found by scripts/db/audit-security.sql (an approximation of the Supabase advisors).
-- Idempotent and additive: it only replaces policies/functions/grants and adds indexes. No data is touched.

-- ---------------------------------------------------------------------------
-- 1. Policy-only helper moves to a schema that is NOT exposed through the Data API (`private`).
--    It stays callable by the roles that evaluate policies, but is no longer an RPC endpoint.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.is_public_book(p_book bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.books b
                  where b.id = p_book and b.status in ('published', 'coming_soon') and b.deleted_at is null)
$$;
revoke all on function private.is_public_book(bigint) from public;
grant execute on function private.is_public_book(bigint) to anon, authenticated, service_role;

drop policy if exists book_categories_read on public.book_categories;
drop policy if exists book_makers_read     on public.book_makers;
drop policy if exists book_tags_read       on public.book_tags;
drop policy if exists book_relations_read  on public.book_relations;
drop policy if exists book_media_read      on public.book_media;
create policy book_categories_read on public.book_categories for select to anon, authenticated using ((select private.is_public_book(book_id)));
create policy book_makers_read     on public.book_makers     for select to anon, authenticated using ((select private.is_public_book(book_id)));
create policy book_tags_read       on public.book_tags       for select to anon, authenticated using ((select private.is_public_book(book_id)));
create policy book_relations_read  on public.book_relations  for select to anon, authenticated using ((select private.is_public_book(book_id)));
create policy book_media_read      on public.book_media      for select to anon, authenticated using ((select private.is_public_book(book_id)));
drop function if exists public.is_public_book(bigint);

-- ---------------------------------------------------------------------------
-- 2. One permissive SELECT policy per role: anon gets the public rule, authenticated gets public OR own OR admin.
-- ---------------------------------------------------------------------------
-- categories
drop policy if exists categories_public_read on public.categories;
drop policy if exists categories_admin_read  on public.categories;
create policy categories_read_anon on public.categories for select to anon using (is_active and deleted_at is null);
create policy categories_read_auth on public.categories for select to authenticated
  using ((is_active and deleted_at is null) or (select public.is_admin()));
-- makers
drop policy if exists makers_public_read on public.makers;
drop policy if exists makers_admin_read  on public.makers;
create policy makers_read_anon on public.makers for select to anon using (is_active and deleted_at is null);
create policy makers_read_auth on public.makers for select to authenticated
  using ((is_active and deleted_at is null) or (select public.is_admin()));
-- books
drop policy if exists books_public_read on public.books;
drop policy if exists books_admin_read  on public.books;
create policy books_read_anon on public.books for select to anon
  using (status in ('published', 'coming_soon') and deleted_at is null);
create policy books_read_auth on public.books for select to authenticated
  using ((status in ('published', 'coming_soon') and deleted_at is null) or (select public.is_admin()));
-- articles
drop policy if exists articles_public_read on public.articles;
drop policy if exists articles_admin_read  on public.articles;
create policy articles_read_anon on public.articles for select to anon using (status = 'published' and deleted_at is null);
create policy articles_read_auth on public.articles for select to authenticated
  using ((status = 'published' and deleted_at is null) or (select public.is_admin()));
-- pages
drop policy if exists pages_public_read on public.pages;
drop policy if exists pages_admin_read  on public.pages;
create policy pages_read_anon on public.pages for select to anon using (status = 'published' and deleted_at is null);
create policy pages_read_auth on public.pages for select to authenticated
  using ((status = 'published' and deleted_at is null) or (select public.is_admin()));
-- comments (anon: public approved comments only; authenticated: + buyer view, own, admin)
drop policy if exists comments_read       on public.comments;
drop policy if exists comments_own_read   on public.comments;
drop policy if exists comments_admin_read on public.comments;
create policy comments_read_anon on public.comments for select to anon
  using (status = 'approved' and visible_to_public);
create policy comments_read_auth on public.comments for select to authenticated
  using ((status = 'approved' and (visible_to_public or (select public.owns_book(book_id))))
         or user_id = (select auth.uid()) or (select public.is_admin()));
-- profiles
drop policy if exists profiles_own_read   on public.profiles;
drop policy if exists profiles_admin_read on public.profiles;
create policy profiles_read_auth on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
-- site_settings: public subset is for everybody
drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_read_anon on public.site_settings for select to anon using (true);
create policy site_settings_read_auth on public.site_settings for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. Evaluate is_admin() once per statement (initplan) in every remaining policy that still calls it per row.
-- ---------------------------------------------------------------------------
do $$
declare r record; v_using text; v_check text; v_sql text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(public\.)?is_admin\(\)'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~* 'select\s+(public\.)?is_admin'
  loop
    v_using := regexp_replace(r.qual,       '(public\.)?is_admin\(\)', '(select public.is_admin())', 'gi');
    v_check := regexp_replace(r.with_check, '(public\.)?is_admin\(\)', '(select public.is_admin())', 'gi');
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null       then v_sql := v_sql || format(' using (%s)', v_using); end if;
    if r.with_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Helper functions that only authenticated users need are no longer callable by anon.
--    (is_admin / is_affiliate / owns_book are evaluated inside policies for authenticated only.)
-- ---------------------------------------------------------------------------
revoke execute on function public.is_admin()      from public, anon;
revoke execute on function public.is_affiliate()  from public, anon;
revoke execute on function public.owns_book(bigint) from public, anon;
grant  execute on function public.is_admin(), public.is_affiliate(), public.owns_book(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Indexes for foreign keys that are joined / checked on delete (performance advisor: unindexed_foreign_keys).
-- ---------------------------------------------------------------------------
create index if not exists user_roles_granted_by_idx           on public.user_roles (granted_by);
create index if not exists book_relations_related_idx          on public.book_relations (related_id);
create index if not exists articles_author_idx                 on public.articles (author_id);
create index if not exists comments_user_idx                   on public.comments (user_id);
create index if not exists favourites_book_idx                 on public.favourites (book_id) where book_id is not null;
create index if not exists favourites_article_idx              on public.favourites (article_id) where article_id is not null;
create index if not exists contact_messages_user_idx           on public.contact_messages (user_id);
create index if not exists payments_affiliate_idx              on public.payments (affiliate_id);
create index if not exists payment_events_payment_idx          on public.payment_events (payment_id);
create index if not exists orders_affiliate_idx                on public.orders (affiliate_id);
create index if not exists order_items_book_idx                on public.order_items (book_id);
create index if not exists entitlements_book_idx               on public.entitlements (book_id);
create index if not exists entitlements_order_item_idx         on public.entitlements (order_item_id);
create index if not exists withdrawal_requests_decided_by_idx  on public.withdrawal_requests (decided_by);
create index if not exists affiliate_ledger_commission_idx     on public.affiliate_ledger (commission_id);
create index if not exists affiliate_ledger_withdrawal_idx     on public.affiliate_ledger (withdrawal_id);
create index if not exists contributor_requests_book_idx       on public.contributor_requests (book_id);
create index if not exists contributor_requests_reviewer_idx   on public.contributor_requests (reviewed_by);
create index if not exists migration_rejects_run_idx           on public.migration_rejects (run_id);
create index if not exists legacy_id_map_run_idx               on public.legacy_id_map (run_id);
create index if not exists legacy_media_staging_media_idx      on public.legacy_media_staging (book_media_id);
create index if not exists legacy_media_staging_dup_idx        on public.legacy_media_staging (duplicate_of);
