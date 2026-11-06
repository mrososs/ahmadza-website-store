-- Fix (found by tests/db/affiliate.test.ts concurrency test): ledger visibility compared available_at with now(), which is
-- the START of the transaction. A request that waited on the per-affiliate lock could therefore not see the withdrawal hold
-- written by the request it waited for (hold.available_at = that transaction's now() is later than its own now()), so two
-- concurrent withdrawals could both pass the balance check.
-- Debits/holds (amount < 0) are effective immediately; credits become available at available_at, evaluated with clock_timestamp().

create or replace function public.affiliate_balance(p_affiliate uuid)
returns table (available numeric, frozen numeric, pending_withdrawal numeric, paid_out numeric, currency text)
language plpgsql stable security definer set search_path = '' as $$
declare v_test boolean;
begin
  if p_affiliate is distinct from (select auth.uid()) and not public.is_admin() and (select auth.role()) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select s.allow_test_payments into v_test from public.site_settings s where s.id = 1;
  return query
  select coalesce(sum(l.amount) filter (where l.amount < 0 or l.available_at <= clock_timestamp()), 0)::numeric,
         coalesce(sum(l.amount) filter (where l.entry_type = 'commission' and l.available_at > clock_timestamp()), 0)::numeric,
         coalesce((select sum(w.amount) from public.withdrawal_requests w where w.affiliate_id = p_affiliate and w.status = 'pending'), 0)::numeric,
         coalesce((select sum(w.amount) from public.withdrawal_requests w where w.affiliate_id = p_affiliate and w.status = 'paid'), 0)::numeric,
         (select s.base_currency::text from public.site_settings s where s.id = 1)
    from public.affiliate_ledger l
   where l.affiliate_id = p_affiliate and (not l.is_test or v_test);
end $$;

create or replace function public.request_withdrawal(p_affiliate uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_prof public.profiles; v_set public.site_settings; v_avail numeric; v_kind text; v_id uuid;
begin
  select * into v_prof from public.profiles where id = p_affiliate for update;   -- per-affiliate mutex
  if not found or not v_prof.is_affiliate or v_prof.status <> 'active' then
    raise exception 'not an active affiliate' using errcode = '42501';
  end if;
  select * into v_set from public.site_settings where id = 1;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount' using errcode = '22023'; end if;
  if p_amount < v_set.min_withdrawal_amount then
    raise exception 'amount below the minimum withdrawal (%)', v_set.min_withdrawal_amount using errcode = '22023';
  end if;
  select coalesce(sum(l.amount), 0) into v_avail from public.affiliate_ledger l
   where l.affiliate_id = p_affiliate and (l.amount < 0 or l.available_at <= clock_timestamp())
     and (not l.is_test or v_set.allow_test_payments);
  if p_amount > v_avail then raise exception 'insufficient available balance' using errcode = '22023'; end if;
  select pm.kind into v_kind from public.payout_methods pm
   where pm.affiliate_id = p_affiliate and pm.is_active order by pm.id limit 1;
  if v_kind is null then raise exception 'no payout method configured' using errcode = '22023'; end if;

  insert into public.withdrawal_requests (affiliate_id, amount, currency, payout_kind)
  values (p_affiliate, p_amount, v_set.base_currency, v_kind) returning id into v_id;
  insert into public.affiliate_ledger (affiliate_id, entry_type, amount, currency, withdrawal_id, memo, available_at)
  values (p_affiliate, 'withdrawal_hold', -p_amount, v_set.base_currency, v_id, 'withdrawal request', clock_timestamp());
  return v_id;
end $$;

create or replace function public.admin_affiliate_overview()
returns table (id uuid, display_name text, email text, phone text, status public.account_status,
               created_at timestamptz, earned numeric, available numeric, frozen numeric)
language sql stable security definer set search_path = '' as $$
  with s as (select st.allow_test_payments as t from public.site_settings st where st.id = 1)
  select p.id, p.display_name, u.email::text, p.phone, p.status, p.created_at,
         coalesce((select sum(c.amount) from public.affiliate_commissions c
                    where c.affiliate_id = p.id and (not c.is_test or (select t from s))), 0)::numeric,
         coalesce((select sum(l.amount) from public.affiliate_ledger l
                    where l.affiliate_id = p.id and (l.amount < 0 or l.available_at <= clock_timestamp())
                      and (not l.is_test or (select t from s))), 0)::numeric,
         coalesce((select sum(l.amount) from public.affiliate_ledger l
                    where l.affiliate_id = p.id and l.entry_type = 'commission' and l.available_at > clock_timestamp()
                      and (not l.is_test or (select t from s))), 0)::numeric
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.is_affiliate and p.deleted_at is null
   order by p.created_at desc
$$;

-- create or replace keeps existing privileges; re-assert them explicitly.
revoke all on function public.request_withdrawal(uuid, numeric) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, numeric) to service_role;
revoke all on function public.admin_affiliate_overview() from public, anon, authenticated;
grant execute on function public.admin_affiliate_overview() to service_role;
revoke all on function public.affiliate_balance(uuid) from public, anon;
grant execute on function public.affiliate_balance(uuid) to authenticated, service_role;
