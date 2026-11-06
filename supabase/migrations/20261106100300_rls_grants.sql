-- AAWRAQ platform — migration 4: Row Level Security + explicit Data API privileges.
--
-- Model:
--   * anon / authenticated may READ published public content and their own private rows.
--   * They never write catalog, commerce, affiliate or settings data. Every privileged write goes through
--     Nitro server routes (service_role, after an is_admin()/ownership check) or the trusted SQL functions.
--   * Column-level grants hide private columns (storage paths, owner ids, gateway payloads) from the Data API.
--   * RLS is enabled on EVERY table; there is no "disable RLS to make it work" anywhere.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'site_settings','profiles','user_roles','audit_log',
    'categories','makers','books','book_categories','book_makers','book_tags','book_relations','book_media',
    'articles','pages','comments','favourites','contact_messages',
    'payments','payment_events','orders','order_items','entitlements',
    'affiliate_commissions','withdrawal_requests','affiliate_ledger','payout_methods','contributor_requests',
    'migration_runs','migration_rejects','legacy_id_map','legacy_media_staging'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
grant usage on schema public to anon, authenticated, service_role;

-- helper: caller owns an active (non-revoked) entitlement for a book
create or replace function public.owns_book(p_book bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.entitlements e
                  where e.book_id = p_book and e.user_id = (select auth.uid()) and e.revoked_at is null)
$$;
create or replace function public.is_affiliate() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_affiliate and p.status = 'active')
$$;
grant execute on function public.is_admin(), public.owns_book(bigint), public.is_affiliate() to anon, authenticated;
grant execute on function public.affiliate_balance(uuid) to authenticated;
revoke execute on function public.affiliate_balance(uuid) from anon, public;
revoke execute on function public.handle_new_user(), public.audit_row_change(), public.books_before_write(),
                         public.orders_guard(), public.order_items_guard(), public.ledger_guard(), public.touch_updated_at()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public catalog (read-only)
-- ---------------------------------------------------------------------------
grant select on public.categories to anon, authenticated;
create policy categories_public_read on public.categories for select to anon, authenticated
  using (is_active and deleted_at is null);
create policy categories_admin_read on public.categories for select to authenticated using (public.is_admin());
grant select (id, name, slug, image_path, is_active, is_demo, legacy_id) on public.categories to anon, authenticated;

grant select (id, name, kind, era, bio_html, image_path, is_active, is_demo, legacy_id) on public.makers to anon, authenticated;
create policy makers_public_read on public.makers for select to anon, authenticated
  using (is_active and deleted_at is null);
create policy makers_admin_read on public.makers for select to authenticated using (public.is_admin());

grant select (id, title, title_norm, slug, description_html, kind, status, price_amount, price_currency, pages, cover_path,
              view_count, is_demo, legacy_id, created_at, updated_at) on public.books to anon, authenticated;
create policy books_public_read on public.books for select to anon, authenticated
  using (status in ('published', 'coming_soon') and deleted_at is null);
create policy books_admin_read on public.books for select to authenticated using (public.is_admin());

-- link tables: visible when the parent book is publicly visible
grant select on public.book_categories, public.book_makers, public.book_tags, public.book_relations to anon, authenticated;
create policy book_categories_read on public.book_categories for select to anon, authenticated
  using (exists (select 1 from public.books b where b.id = book_id and b.status in ('published','coming_soon') and b.deleted_at is null));
create policy book_makers_read on public.book_makers for select to anon, authenticated
  using (exists (select 1 from public.books b where b.id = book_id and b.status in ('published','coming_soon') and b.deleted_at is null));
create policy book_tags_read on public.book_tags for select to anon, authenticated
  using (exists (select 1 from public.books b where b.id = book_id and b.status in ('published','coming_soon') and b.deleted_at is null));
create policy book_relations_read on public.book_relations for select to anon, authenticated
  using (exists (select 1 from public.books b where b.id = book_id and b.status in ('published','coming_soon') and b.deleted_at is null));

-- book_media: metadata only. storage_path / external_url / sha256 stay server-side.
grant select (id, book_id, kind, visibility, name, extension, page_count, sort_order, is_external) on public.book_media to anon, authenticated;
create policy book_media_read on public.book_media for select to anon, authenticated
  using (exists (select 1 from public.books b where b.id = book_id and b.status in ('published','coming_soon') and b.deleted_at is null));

grant select (id, kind, title, excerpt, content_html, poster_path, status, view_count, is_demo, created_at, updated_at) on public.articles to anon, authenticated;
create policy articles_public_read on public.articles for select to anon, authenticated
  using (status = 'published' and deleted_at is null);
create policy articles_admin_read on public.articles for select to authenticated using (public.is_admin());

grant select (id, slug, title, content_html, positions, status, is_demo, updated_at) on public.pages to anon, authenticated;
create policy pages_public_read on public.pages for select to anon, authenticated
  using (status = 'published' and deleted_at is null);
create policy pages_admin_read on public.pages for select to authenticated using (public.is_admin());

-- Public subset of the settings row (never commission %, MFA flag, pending list…)
grant select (id, site_name, phone, email, description, keywords, facebook, twitter, instagram, youtube, telegram, linkedin,
              whatsapp, broadcast, logo_path, poster_path, poster_mobile_path, show_poster_desktop, show_poster_mobile,
              show_free_book_button, base_currency) on public.site_settings to anon, authenticated;
create policy site_settings_public_read on public.site_settings for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Comments & favourites (customer-owned writes, limited columns)
-- ---------------------------------------------------------------------------
grant select (id, user_id, book_id, body, status, visible_to_public, created_at) on public.comments to anon, authenticated;
create policy comments_read on public.comments for select to anon, authenticated
  using (status = 'approved' and (visible_to_public or public.owns_book(book_id)));
create policy comments_own_read on public.comments for select to authenticated using (user_id = (select auth.uid()));
create policy comments_admin_read on public.comments for select to authenticated using (public.is_admin());
grant insert (user_id, book_id, body) on public.comments to authenticated;
create policy comments_insert_own on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and visible_to_public = false
              and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'));

grant select, delete on public.favourites to authenticated;
grant insert (user_id, book_id, article_id) on public.favourites to authenticated;
create policy favourites_own_read   on public.favourites for select to authenticated using (user_id = (select auth.uid()));
create policy favourites_own_insert on public.favourites for insert to authenticated with check (user_id = (select auth.uid()));
create policy favourites_own_delete on public.favourites for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
grant select (id, display_name, phone, country, country_code, region, status, is_affiliate, require_password_reset, created_at) on public.profiles to authenticated;
create policy profiles_own_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_admin_read on public.profiles for select to authenticated using (public.is_admin());
-- self-service update: ONLY harmless columns (status / is_affiliate stay admin-or-server controlled)
grant update (display_name, phone, country, country_code, region) on public.profiles to authenticated;
create policy profiles_own_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select on public.user_roles to authenticated;
create policy user_roles_own_read on public.user_roles for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

grant select on public.audit_log to authenticated;
create policy audit_log_admin_read on public.audit_log for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Commerce (read-only for customers; writes only via fulfill_payment & friends)
-- ---------------------------------------------------------------------------
grant select on public.orders, public.order_items, public.entitlements to authenticated;
create policy orders_own_read on public.orders for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy order_items_own_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.is_admin())));
create policy entitlements_own_read on public.entitlements for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

grant select (id, reference, user_id, provider, status, amount, currency, fx_rate, mode, affiliate_id, order_id, created_at, expires_at, paid_at, fulfilled_at)
  on public.payments to authenticated;
create policy payments_own_read on public.payments for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- payment_events: no policy → invisible to every Data API role

-- ---------------------------------------------------------------------------
-- Affiliate & contributor
-- ---------------------------------------------------------------------------
grant select on public.affiliate_commissions, public.affiliate_ledger to authenticated;
create policy commissions_own_read on public.affiliate_commissions for select to authenticated using (affiliate_id = (select auth.uid()) or public.is_admin());
create policy ledger_own_read      on public.affiliate_ledger      for select to authenticated using (affiliate_id = (select auth.uid()) or public.is_admin());

grant select (id, affiliate_id, amount, currency, status, payout_kind, note, requested_at, decided_at) on public.withdrawal_requests to authenticated;
create policy withdrawals_own_read on public.withdrawal_requests for select to authenticated using (affiliate_id = (select auth.uid()) or public.is_admin());

grant select, insert, update, delete on public.payout_methods to authenticated;
create policy payout_methods_own on public.payout_methods for all to authenticated
  using (affiliate_id = (select auth.uid()) and public.is_affiliate())
  with check (affiliate_id = (select auth.uid()) and public.is_affiliate());
create policy payout_methods_admin_read on public.payout_methods for select to authenticated using (public.is_admin());

grant select on public.contributor_requests to authenticated;
create policy contributor_own_read on public.contributor_requests for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- contact messages, migration bookkeeping: admin read only (all writes server-side)
grant select on public.contact_messages, public.migration_runs, public.migration_rejects, public.legacy_id_map, public.legacy_media_staging to authenticated;
create policy contact_admin_read on public.contact_messages for select to authenticated using (public.is_admin());
create policy migration_runs_admin_read on public.migration_runs for select to authenticated using (public.is_admin());
create policy migration_rejects_admin_read on public.migration_rejects for select to authenticated using (public.is_admin());
create policy legacy_id_map_admin_read on public.legacy_id_map for select to authenticated using (public.is_admin());
create policy legacy_media_staging_admin_read on public.legacy_media_staging for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage buckets (created here so `supabase db reset` yields a complete local environment)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('public-media',      'public-media',      true,  10485760,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('private-products',  'private-products',  false, 104857600, array['application/pdf','audio/mpeg','audio/mp4','audio/ogg','audio/wav']),
  ('private-sensitive', 'private-sensitive', false, 26214400,  array['application/pdf','image/png','image/jpeg','image/webp']),
  ('legacy-staging',    'legacy-staging',    false, 104857600, array['application/pdf','audio/mpeg'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Only public-media is readable through the Data API; the three private buckets have NO policy,
-- so objects are reachable exclusively via server-generated short-lived signed URLs.
create policy "public-media is world readable" on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-media');

-- Public aggregate counters for the statistics band (no row access needed).
create or replace function public.site_totals()
returns table (books bigint, articles bigint, views bigint)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.books b where b.status in ('published','coming_soon') and b.deleted_at is null),
         (select count(*) from public.articles a where a.status = 'published' and a.deleted_at is null),
         (select coalesce(sum(b.view_count), 0) from public.books b where b.status in ('published','coming_soon') and b.deleted_at is null)
         + (select coalesce(sum(a.view_count), 0) from public.articles a where a.status = 'published' and a.deleted_at is null)
$$;
grant execute on function public.site_totals() to anon, authenticated;
