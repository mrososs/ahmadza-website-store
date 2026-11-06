# Hosted Supabase setup — AAWRAQ project `ubjuyeccioflhpcpnhmo`

## Status (read this first)
| Item | State |
|---|---|
| Authorised project | `ubjuyeccioflhpcpnhmo` — `https://ubjuyeccioflhpcpnhmo.supabase.co`. It answers (HTTP 401 "No API key found" without a key), so it exists. |
| Forbidden project | the owner's personal-website project `ahmadza-web` — never touched, never referenced by this codebase (and the server refuses to start against it, see *Safety guards*). |
| MCP | `.mcp.json` (project scope) points at `https://mcp.supabase.com/mcp?project_ref=ubjuyeccioflhpcpnhmo&…`. Status: **pending approval / OAuth**. Only the account owner can complete it (see below). |
| Supabase CLI | logged in to a **different** account: `supabase projects list` returns 4 unrelated projects and **not** `ubjuyeccioflhpcpnhmo`. It therefore cannot `link`/`push` to the AAWRAQ project, and nothing was run against any of those projects. |
| Hosted migrations applied | **none** (no authorised access in this session). |
| Hosted data/Auth/advisors inspected | **no** — blocked by the above. |

**What the owner must do once** (no tokens or passwords are ever pasted into chat):
1. In a normal terminal in `new-platform/` run `claude`, open `/mcp`, choose **supabase**, approve it, and complete the Supabase OAuth login **with the account that owns `ubjuyeccioflhpcpnhmo`** (select only that project when asked).
2. Create `.env.hosted` from `.env.hosted.example` and paste the project's *publishable* and *secret* keys (Dashboard → Project Settings → API Keys). The file is git-ignored.
3. Tell the agent "hosted access is ready"; it will run the procedure below.

## Procedure to run when access exists (all steps are non-destructive and re-checked)
1. **Verify identity** — MCP `get_project`/`list_projects` must return ref `ubjuyeccioflhpcpnhmo`; abort on any other ref. Repeat before every remote-changing call.
2. **Inspect** — health, schemas, tables, `supabase_migrations.schema_migrations`, existing RLS, Auth settings; run **Security** and **Performance advisors** and save the output.
3. **Preflight (offline)** — `npm run hosted:preflight` (validates `.env.hosted`, migration order, destructive-statement scan). Fresh project ⇒ plain apply; non-empty project ⇒ diff first, write a non-destructive reconciliation migration, never reset.
4. **Apply** — either MCP `apply_migration` per file in order, or CLI: `npx supabase link --project-ref ubjuyeccioflhpcpnhmo` then `npx supabase db push --dry-run` → review → `npx supabase db push`. **`supabase/seed.sql` is never run on the hosted project** (`db push` does not run it; do not `psql` it).
5. **Verify** — `npm run audit:db`-equivalent SQL through MCP `execute_sql` (`scripts/db/audit-security.sql`), compare table/policy/function lists with local, run advisors again, regenerate types (`supabase gen types typescript --project-id ubjuyeccioflhpcpnhmo`).
6. **Auth settings** — apply `AUTH_INTEGRATION.md` §Hosted settings (redirect URLs, confirmations, MFA, SMTP).
7. **Bootstrap the first admin** — `node scripts/admin/bootstrap-admin.mjs --email <owner> --invite --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo --yes`, then `--grant` after the invitation is accepted. No password is ever set by us.
8. **Run the hosted checks** — `npm run dev:hosted` and the hosted subset of the test-suite (`HOSTED_TEST_RESULTS` in `HOSTED_INTEGRATION_TEST_RESULTS.md`).

## Safety guards already in the codebase
* `shared/utils/supabaseTarget.ts` + `server/plugins/00-supabase-target-guard.ts`: the Nitro server **refuses to start** if `NUXT_PUBLIC_SUPABASE_URL` is anything except localhost or `https://ubjuyeccioflhpcpnhmo.supabase.co`, and refuses localhost when `NODE_ENV=production`. Verified on the built server (cases: localhost-in-prod ✗, other project ✗, authorised project ✓) and by `tests/unit/supabase-target.test.ts`.
* `scripts/admin/bootstrap-admin.mjs` repeats the check and demands `--confirm-project <ref> --yes` for hosted targets.
* `scripts/db/hosted-preflight.mjs` fails if `.env.hosted` enables the dev payment simulator or the `supabase` media provider.
* All local test helpers refuse non-local URLs (`tests/helpers/supabase.ts`); hosted tests are a separate, explicit step.
* Environment separation: `.env` (local) vs `.env.hosted` (hosted) via `npm run dev` / `npm run dev:hosted`; only the two `*.example` files are tracked.

## Keys
* Publishable key (`sb_publishable_…`) → browser + SSR (`NUXT_PUBLIC_SUPABASE_KEY`), protected by RLS.
* Secret key (`sb_secret_…`) → `NUXT_SUPABASE_SECRET_KEY`, Nitro runtime only; never in the repository, never printed.
* The application reads no other key, and no key is hardcoded.
