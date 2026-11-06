-- Slice C (administration): server-only helpers. All functions are SECURITY DEFINER and callable ONLY by service_role
-- (the Nitro admin routes call them after requireAdmin()).

create or replace function public.admin_list_users(p_q text, p_status text, p_limit integer, p_offset integer)
returns table (id uuid, email text, display_name text, status public.account_status, is_affiliate boolean,
               created_at timestamptz, deleted_at timestamptz, total_count bigint)
language sql stable security definer set search_path = '' as $$
  with base as (
    select p.id, u.email::text as email, p.display_name, p.status, p.is_affiliate, p.created_at, p.deleted_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where (case when p_status = 'trash' then p.deleted_at is not null
                 when p_status in ('review', 'active', 'banned') then p.deleted_at is null and p.status = p_status::public.account_status
                 else p.deleted_at is null end)
       and (coalesce(btrim(p_q), '') = '' or p.display_name ilike '%' || p_q || '%' or u.email ilike '%' || p_q || '%')
  )
  select b.id, b.email, b.display_name, b.status, b.is_affiliate, b.created_at, b.deleted_at, count(*) over () as total_count
    from base b order by b.created_at desc limit greatest(p_limit, 1) offset greatest(p_offset, 0)
$$;

revoke all on function public.admin_list_users(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, text, integer, integer) to service_role;
-- demo purge (defined in migration 2) must also be reachable by the admin route through service_role
grant execute on function public.purge_demo_data() to service_role;
