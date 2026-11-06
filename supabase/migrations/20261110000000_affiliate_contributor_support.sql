-- Slice D (affiliates + contributors): additive support objects. Nothing here weakens RLS; every new function is
-- service_role-only (execute revoked from public/anon/authenticated) and is called by Nitro routes after an
-- authorisation check.

-- Legacy withdraw_types.status ("مفعلة / غير مفعلة") -> payout_methods.is_active
alter table public.payout_methods add column if not exists is_active boolean not null default true;

-- Contributor book PDFs (<= 100 MB, legacy limit) live in private-sensitive until approval; raise the bucket cap.
update storage.buckets
   set file_size_limit = 104857600,
       allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp']
 where id = 'private-sensitive';

-- Resolve an auth user by e-mail (admin promotes an existing customer to affiliate).
create or replace function public.find_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1
$$;

-- Admin overview of affiliates with ledger-derived balances (never a stored balance).
create or replace function public.admin_affiliate_overview()
returns table (id uuid, display_name text, email text, phone text, status public.account_status,
               created_at timestamptz, earned numeric, available numeric, frozen numeric)
language sql stable security definer set search_path = '' as $$
  with s as (select st.allow_test_payments as t from public.site_settings st where st.id = 1)
  select p.id, p.display_name, u.email::text, p.phone, p.status, p.created_at,
         coalesce((select sum(c.amount) from public.affiliate_commissions c
                    where c.affiliate_id = p.id and (not c.is_test or (select t from s))), 0)::numeric,
         coalesce((select sum(l.amount) from public.affiliate_ledger l
                    where l.affiliate_id = p.id and l.available_at <= now() and (not l.is_test or (select t from s))), 0)::numeric,
         coalesce((select sum(l.amount) from public.affiliate_ledger l
                    where l.affiliate_id = p.id and l.entry_type = 'commission' and l.available_at > now()
                      and (not l.is_test or (select t from s))), 0)::numeric
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.is_affiliate and p.deleted_at is null
   order by p.created_at desc
$$;

-- Per-book statistics for a contributor's own books (views, purchases, gross sales). No payout maths: the legacy
-- implementation had no contributor settlement and none is invented here.
create or replace function public.contributor_book_stats(p_user uuid)
returns table (book_id bigint, views integer, purchases bigint, gross numeric)
language sql stable security definer set search_path = '' as $$
  with s as (select st.allow_test_payments as t from public.site_settings st where st.id = 1)
  select b.id, b.view_count,
         count(oi.id) filter (where o.id is not null and (o.mode = 'live' or (select t from s))),
         coalesce(sum(oi.unit_price) filter (where o.id is not null and (o.mode = 'live' or (select t from s))), 0)::numeric
    from public.books b
    left join public.order_items oi on oi.book_id = b.id
    left join public.orders o on o.id = oi.order_id and o.status = 'paid'
   where b.owner_id = p_user and b.deleted_at is null
   group by b.id, b.view_count
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.find_user_id_by_email(text)',
    'public.admin_affiliate_overview()',
    'public.contributor_book_stats(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
