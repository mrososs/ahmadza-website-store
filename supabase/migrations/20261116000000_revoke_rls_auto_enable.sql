-- AAWRAQ platform — migration 16: stop exposing Supabase's `public.rls_auto_enable()` through the Data API.
-- On hosted projects it is the function behind the `ensure_rls` EVENT TRIGGER (auto-enables RLS on new public tables). It is
-- SECURITY DEFINER and carried EXECUTE for PUBLIC/anon/authenticated, so Supabase's linter flags `/rest/v1/rpc/rls_auto_enable`.
-- Event triggers do not check EXECUTE at fire time, so the safety net keeps working; the owner (postgres) and service_role keep EXECUTE.
-- The local stack does not have the function at all, hence the guard (the migration replays cleanly on both).
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
