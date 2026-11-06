# Hosted migration runbook — project `ubjuyeccioflhpcpnhmo`

Run these in **your own PowerShell** in `new-platform/`. Flags below were taken from the installed CLI's `--help` (Supabase CLI 3.0.0), not from memory.
**CLI 3 targets the LOCAL database by default**; every hosted command needs `--remote`. Never pass `--include-seed` (the seed is local-only demo data). Never paste passwords or tokens into chat.

## 0. State verified before this runbook (MCP, read-only)
Hosted project: empty `public` schema, `supabase_migrations` history empty, 0 auth users, 0 storage objects. Only advisor findings: 2 WARN for the Supabase-provided `public.rls_auto_enable()`.
Local: 15 migrations applied and in order (`npx supabase migration list`, local default). Preflight: `npm run hosted:preflight` → 15 ordered, no destructive DDL outside reviewed demo-purge bodies.

## 1. Authenticate as the account that owns the project
```powershell
npx supabase logout            # drops the wrong account's token from this machine
npx supabase login             # browser flow — pick the account that owns ubjuyeccioflhpcpnhmo
npx supabase projects list     # MUST list ubjuyeccioflhpcpnhmo. If it does not, STOP: wrong account.
```

## 2. Link and compare histories (read-only)
```powershell
npx supabase link --project-ref ubjuyeccioflhpcpnhmo       # asks for the database password (type it; do not paste it anywhere else)
npx supabase migration list --remote                       # expect: 15 local rows, remote column EMPTY
```

## 3. Dry run — review before anything is written
```powershell
npx supabase db push --remote --dry-run
```
Expected output: exactly the 15 files `20261106100000` … `20261115000000`, in that order, and nothing else. If anything else appears, or the order differs, stop and send the output.

## 4. The write (needs your decision)
```powershell
npx supabase db push --remote
```
Applies the same 15 files with their original version numbers, so local and hosted histories stay identical. Seed data is **not** applied (no `--include-seed`).

## 5. Verify (read-only)
```powershell
npx supabase migration list --remote                       # 15 / 15, both columns filled
npm run db:fingerprint                                     # local baseline -> migration-output/fingerprint-local.json (already generated)
node scripts/db/fingerprint.mjs --emit-sql > $env:TEMP\fp.sql
```
Run `$env:TEMP\fp.sql` unchanged on the hosted project (SQL editor, or ask the agent to run it through the MCP `execute_sql`), save the rows as JSON, then:
```powershell
node scripts/db/compare-fingerprint.mjs migration-output/fingerprint-local.json <hosted-rows.json>
```
Every section (enums, columns, constraints, indexes, rls, policies, functions, triggers, table_grants, column_grants, buckets) must show `ok`. `rls_auto_enable` is deliberately excluded (hosted-only Supabase default). A `DIFF` lists the exact objects (re-run with `--detail` on both sides).
Also run `scripts/db/audit-security.sql` hosted (expect the 8 reviewed findings in `RLS_PERMISSION_MATRIX.md`), and the Security + Performance advisors.

### Result of §1–§5 and migrations 16–17 (executed and verified 2026-11-06)
* CLI account lists the project; link OK; first push (migrations 1–15) and second push (16–17, run with `--remote`) by the owner. `migration list --remote` → **17 local / 17 remote / 0 mismatched**; MCP `list_migrations` lists the same 17.
* **Schema fingerprint local vs hosted: all 12 sections identical** (enums 20, columns 328, constraints 131, indexes 100, rls 31, policies 45, functions 31, triggers 20, table_grants 56, column_grants 378, buckets 4, seed_singletons 1). The fingerprint ignores one attribute only: hosted's default `service_role` EXECUTE grant on **trigger-returning** functions (hosted keeps it, local does not; harmless because a trigger function cannot be called outside a trigger). `rls_auto_enable()` is excluded (hosted-only Supabase helper) and checked separately below.
* **`rls_auto_enable()`:** ACL is now only `postgres` + `service_role` (anon/authenticated/PUBLIC revoked). The `ensure_rls` event trigger is still enabled and **still fires**: a table created inside a rolled-back transaction came out with RLS enabled automatically; nothing persisted.
* **`payout_methods`:** four policies (select / insert / update / delete), one permissive SELECT policy; access identical to before (tests/db + hosted suite).
* **Advisors (hosted), after migrations 16–17:** security — INFO `payment_events` RLS-enabled with no policy (intended: service-role only); WARN SECURITY DEFINER executable = the six reviewed intentional functions (`book_comments`, `site_totals` for anon+authenticated; `affiliate_balance`, `is_admin`, `is_affiliate`, `owns_book` for authenticated). The two `rls_auto_enable` warnings are gone. Performance — the multiple-permissive-policies WARN is gone; 14 INFO unused indexes remain (expected on an empty database; do not drop).

## 6. Hosted RLS suite (creates and deletes its own tagged fixtures)
```powershell
# .env.hosted must exist with the publishable + secret keys (Dashboard -> Project Settings -> API Keys); it is git-ignored
$env:HOSTED_TEST_CONFIRM = 'ubjuyeccioflhpcpnhmo'
npm run test:hosted
Remove-Item Env:HOSTED_TEST_CONFIRM
```
13 tests: anonymous / customer / admin separation, protected columns, forged money paths, function privileges, simulator OFF. It refuses any other project ref, localhost, or a missing confirmation. It was rehearsed on the local stack (12 passed, 1 hosted-only test skipped); it has **not** been run against hosted.

## 6b. Hosted application checks (verified 2026-11-06: 24 + 15 tests passing)
```powershell
npm run dev:hosted:3100          # second dev server on :3100 pointed at the hosted project (own build dir .nuxt-hosted; the local :3000 server is untouched)
$env:HOSTED_TEST_CONFIRM = 'ubjuyeccioflhpcpnhmo'; $env:TEST_APP_URL = 'http://localhost:3100'
npm run test:hosted              # tests/hosted/rls-hosted.test.ts (15) + tests/hosted/nuxt-hosted.test.ts (24)
Remove-Item Env:HOSTED_TEST_CONFIRM, Env:TEST_APP_URL
node scripts/admin/verify-hosted-auth.mjs --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo     # Auth settings + redirect allow-list (sends no e-mail)
```
Each run creates and deletes tagged synthetic records and scrubs only its own audit rows. 10 audit rows from earlier runs (synthetic admin grants/revokes, no real data) remain; deleting them is an owner decision.

## 6c. DONE — migrations 16 and 17 (applied by the owner with --remote, verified above)
`20261116000000_revoke_rls_auto_enable.sql` (revokes EXECUTE on `public.rls_auto_enable()` from PUBLIC/anon/authenticated; owner and `service_role` keep it; guarded because the function exists only on hosted) and
`20261116000100_payout_methods_single_select_policy.sql` (one permissive SELECT policy; identical access). Local: applied, `tests/db` + `tests/api` 203/203, new `security-followups` 4/4, `npm run audit:db` unchanged (8 reviewed, 0 unexpected).
The CLI refuses hosted writes in agent mode without `--yes` (*"ask the user before re-running with --yes"*), so run it yourself:
```powershell
npx supabase db push --remote --dry-run     # must list exactly the two files above, seeds: []
npx supabase db push --remote               # answer Yes
```
Then tell the agent; it verifies: `migration list --remote` 17/17 · advisors (no `rls_auto_enable` WARN, no `multiple_permissive_policies`) · fingerprint `policies` section equal to local · and that the `ensure_rls` event trigger still enables RLS (a probe inside a rolled-back transaction):
```sql
begin; create table public._rls_probe(id int); select relrowsecurity from pg_class where oid = 'public._rls_probe'::regclass; rollback;   -- expect true, nothing persists
```

## 7. Do NOT
`supabase db reset`, `db push` without `--remote` (that is the local DB), `--include-seed`, `psql < seed.sql`, any command against another project ref, `supabase link` to any ref other than the one above.

## 8. If a step fails
Send the exact output of that step. Do not retry destructive variants. Migrations are applied in order inside transactions per file by the CLI; a failed file leaves the earlier ones applied, and `migration list --remote` shows where it stopped.
