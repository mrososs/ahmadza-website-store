-- Fix: migration 4 revoked affiliate_balance() from PUBLIC (so anon cannot call it) but never granted it to service_role,
-- which the affiliate/admin Nitro routes use. authenticated keeps access (the function itself restricts to own id / admin).
grant execute on function public.affiliate_balance(uuid) to service_role;
