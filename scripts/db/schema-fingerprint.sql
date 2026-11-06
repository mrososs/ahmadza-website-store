-- Read-only catalog fingerprint of everything the 15 migrations create. Run it UNCHANGED against the local DB and the hosted
-- AAWRAQ project (MCP execute_sql / SQL editor), then compare (scripts/db/compare-fingerprint.mjs). It never writes.
-- Default output: one row per section with a digest (tiny). `node scripts/db/fingerprint.mjs --detail` swaps the last line
-- for the version that also returns every entry, so a digest mismatch can be narrowed down to the exact objects.
with fp(section, entries) as (
  values
  ('enums', (select coalesce(jsonb_object_agg(t.typname, t.labels), '{}'::jsonb) from (
      select t.typname, jsonb_agg(e.enumlabel order by e.enumsortorder) labels
        from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' group by t.typname) t)),
  ('columns', (select coalesce(jsonb_object_agg(table_name || '.' || column_name,
        jsonb_build_array(data_type, is_nullable, coalesce(column_default, ''), coalesce(is_identity, ''), coalesce(generation_expression, ''))), '{}'::jsonb)
      from information_schema.columns where table_schema = 'public')),
  ('constraints', (select coalesce(jsonb_object_agg(c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)), '{}'::jsonb)
      from pg_constraint k join pg_class c on c.oid = k.conrelid where k.connamespace = 'public'::regnamespace)),
  ('indexes', (select coalesce(jsonb_object_agg(indexname, indexdef), '{}'::jsonb) from pg_indexes where schemaname = 'public')),
  ('rls', (select coalesce(jsonb_object_agg(c.relname, jsonb_build_array(c.relrowsecurity, c.relforcerowsecurity)), '{}'::jsonb)
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p'))),
  ('policies', (select coalesce(jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname,
        jsonb_build_array(cmd, roles::text, coalesce(qual, ''), coalesce(with_check, ''))), '{}'::jsonb)
      from pg_policies where schemaname in ('public', 'storage') and (schemaname = 'public' or policyname !~ '^(Allow|supabase)'))),
  ('functions', (select coalesce(jsonb_object_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        jsonb_build_array(p.prosecdef, coalesce(p.proconfig::text, ''), md5(p.prosrc),
          has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('service_role', p.oid, 'execute'))), '{}'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prokind = 'f' and p.proname <> 'rls_auto_enable')),   -- rls_auto_enable is a Supabase-provided hosted default
  ('triggers', (select coalesce(jsonb_object_agg(n.nspname || '.' || c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)), '{}'::jsonb)
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users')))),
  ('table_grants', (select coalesce(jsonb_object_agg(table_name || '.' || grantee, privs), '{}'::jsonb) from (
      select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') group by table_name, grantee) g)),
  ('column_grants', (select coalesce(jsonb_object_agg(table_name || '.' || column_name || '.' || grantee, privs), '{}'::jsonb) from (
      select table_name, column_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
        from information_schema.column_privileges
       where table_schema = 'public' and grantee in ('anon', 'authenticated') group by table_name, column_name, grantee) g)),
  ('buckets', (select coalesce(jsonb_object_agg(id, jsonb_build_array(public, file_size_limit, coalesce(allowed_mime_types::text, ''))), '{}'::jsonb) from storage.buckets)),
  ('seed_singletons', jsonb_build_object('site_settings_rows', (select count(*) from public.site_settings)))
)
select section, (select count(*) from jsonb_object_keys(entries)) as n, md5(entries::text) as digest from fp order by section;
-- DETAIL-LINE: select section, (select count(*) from jsonb_object_keys(entries)) as n, md5(entries::text) as digest, entries from fp order by section;
