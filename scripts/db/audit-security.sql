-- Read-only schema audit approximating the Supabase Security/Performance advisors for the `public` schema.
-- Runs unchanged against the local DB (psql) and — later — the hosted AAWRAQ project (MCP execute_sql). It never writes.
-- Each query returns ZERO rows when clean.

-- 1. [security] public tables with RLS disabled
select 'rls_disabled' as lint, c.relname as object
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 2. [security] SECURITY DEFINER functions executable by PUBLIC / anon / authenticated (review each; expected: is_admin, owns_book, is_affiliate, is_public_book, site_totals, affiliate_balance, book_comments)
select 'definer_exposed:' || (case when has_function_privilege('anon', p.oid, 'execute') then 'anon' else 'authenticated' end) as lint,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 2;

-- 3. [security] functions without a pinned search_path
select 'mutable_search_path' as lint, p.proname as object
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');

-- 4. [security] anon/authenticated holding write privileges on tables (review; expected: favourites, comments, profiles(update cols), payout_methods)
select 'write_grant:' || grantee as lint, table_name || ':' || string_agg(distinct privilege_type, ',') as object
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
 group by grantee, table_name order by 1, 2;

-- 5. [performance] foreign keys without a covering index
select 'unindexed_fk' as lint, c.conrelid::regclass::text || '(' || string_agg(a.attname, ',') || ')' as object
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
 where c.contype = 'f' and c.connamespace = 'public'::regnamespace
   and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey)
 group by c.conrelid, c.conname;

-- 6. [performance] several permissive policies for the same role + command on one table
select 'multiple_permissive_policies' as lint, schemaname || '.' || tablename || ' ' || cmd || ' ' || r as object
  from (select schemaname, tablename, cmd, unnest(roles) r, count(*) n from pg_policies
         where schemaname = 'public' and permissive = 'PERMISSIVE' group by 1, 2, 3, 4) q
 where n > 1 order by 2;

-- 7. [performance] policies calling auth.uid()/auth.role()/auth.jwt() without the (select …) wrapper (re-evaluated per row)
select 'auth_rls_initplan' as lint, tablename || '.' || policyname as object
  from pg_policies
 where schemaname = 'public'
   and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'auth\.(uid|role|jwt)\(\)'
   and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~* '\(\s*select\s+auth\.(uid|role|jwt)\(\)';

-- 8. [security] views without security_invoker
select 'view_security_definer' as lint, c.relname as object
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v' and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false);
