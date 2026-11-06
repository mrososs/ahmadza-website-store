# Hosted integration test results

## Hosted project `ubjuyeccioflhpcpnhmo`: **not tested — blocked on access**
No credential for the authorised project exists in this environment (the CLI account does not contain it; the project MCP awaits the owner's OAuth approval — see `HOSTED_SUPABASE_SETUP.md`).
Nothing was run against it, and nothing was run against any other hosted project.

| Hosted check | Status |
|---|---|
| Project identity / health / schema / migration history / Auth config | not run (blocked) |
| Migration apply + local↔remote comparison | not run (blocked; preflight + inventory ready) |
| Security & Performance advisors | not run (blocked; local equivalent below) |
| RLS matrix over REST (anon / customer A,B / affiliate / admin) | not run (blocked; suite ready: `tests/db/rls*.test.ts`) |
| Auth: register, confirm, login, recovery, SSR session, admin role | not run (blocked) |
| Nuxt `npm run dev:hosted` connectivity, storefront reads, admin CRUD | not run (blocked) |
| Payment boundaries on hosted | not run; **no payment gateway is configured** (simulator is refused against hosted by the preflight and by `allow_test_payments=false`) |

To make the existing suites hosted-capable the next step must (a) create hosted fixtures through the Auth admin API (confirmed test users with random passwords, deleted afterwards — **not** the local `*.aawraq.test` identities), (b) relax `tests/helpers/supabase.ts`' local-only guard behind an explicit `TEST_TARGET=hosted` + project-ref confirmation, and (c) skip tests that need `site_settings.allow_test_payments` or demo media. Real customer data is never touched by tests.

## Local stack (same code, same migrations) — executed 2026-11-06
| Gate | Result |
|---|---|
| `supabase db reset` (15 migrations + seed) | ✅ clean replay |
| `npm run typecheck` (app/server/shared/node) | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors |
| `npm test` (vitest: unit + DB + API) | ✅ **247 / 247** in 19 files |
| `npm run audit:db` (advisor-style SQL audit) | ✅ 0 unexpected findings (8 reviewed intentional) |
| `npm run build` (production) | ✅ |
| Built server start guard (localhost-in-prod ✗, other project ✗, authorised ✓) | ✅ verified manually on `.output` |
| Playwright UI validation / refinement | ✅ 45/45 and 55/55 (re-run after the book-page pending-media change: see below) |

New in this phase (26 tests): `tests/db/rls-ownership.test.ts` (11 — ownership reassignment, raw PostgREST access, private-schema, function grants), `tests/api/media-storage.test.ts` (10 — metadata model, safe delivery failure, column privacy), `tests/unit/supabase-target.test.ts` (5).

## Payment boundary results (local)
* Prices come only from the database (`create_payment_for_cart`); client-supplied prices/totals are ignored (`checkout.test.ts`).
* Customers cannot insert orders/payments/entitlements/ledger rows or execute `fulfill_payment` (`rls.test.ts`, `rls-ownership.test.ts` — over SDK **and** raw REST).
* `fulfill_payment` is idempotent; webhook replays create one order/entitlement/commission (`commerce.test.ts`, `checkout.test.ts`).
* **No real payment gateway exists.** The development simulator is a labelled test tool (`mode='test'`, `is_test` flags, refused in production and when `allow_test_payments=false`); a simulated payment is never a genuine sale.

## Media boundary results (local)
Non-available media, disabled providers, VPS rows and non-https external links all fail with an explicit 503/404 and no location header; storage keys, providers, checksums and legacy paths are unreadable through the Data API.
