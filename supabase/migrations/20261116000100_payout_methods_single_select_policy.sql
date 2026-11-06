-- AAWRAQ platform — migration 17: one permissive SELECT policy on payout_methods (performance advisor 0006).
-- Before: `payout_methods_own` (ALL, own rows + affiliate) and `payout_methods_admin_read` (SELECT, admin) both applied to SELECT.
-- After: identical access, expressed once per command. Own rows (affiliates only) can read/insert/update/delete; admins can read all;
-- WITH CHECK still pins `affiliate_id` to the caller so a row can never be moved to someone else. Helpers are wrapped in (select …)
-- so they are evaluated once per statement, as in migration 14.
drop policy if exists payout_methods_admin_read on public.payout_methods;
drop policy if exists payout_methods_own on public.payout_methods;

create policy payout_methods_select on public.payout_methods for select to authenticated
  using (((select auth.uid()) = affiliate_id and (select public.is_affiliate())) or (select public.is_admin()));

create policy payout_methods_insert on public.payout_methods for insert to authenticated
  with check ((select auth.uid()) = affiliate_id and (select public.is_affiliate()));

create policy payout_methods_update on public.payout_methods for update to authenticated
  using ((select auth.uid()) = affiliate_id and (select public.is_affiliate()))
  with check ((select auth.uid()) = affiliate_id and (select public.is_affiliate()));

create policy payout_methods_delete on public.payout_methods for delete to authenticated
  using ((select auth.uid()) = affiliate_id and (select public.is_affiliate()));
