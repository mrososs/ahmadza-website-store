# 09 — Testing results

All numbers below were produced on 2026-11-06 against the **local** stack (Supabase CLI 3.0.0 local containers + `nuxt dev` on :3000). Nothing was run against a hosted environment.

| Gate | Command | Result |
|---|---|---|
| Migrations reproducible | `npx supabase db reset` (13 migrations + seed) | ✅ applies cleanly in order; suite re-run afterwards from the rebuilt state |
| Type check (4 TS projects: app, server, shared, node) | `npx vue-tsc --noEmit -p .nuxt/tsconfig.<p>.json` | ✅ 0 errors (the Volar "sfc-route-blocks" plugin warning is a vue-router/volar export mismatch and is harmless) |
| Lint | `npm run lint` (ESLint 9 flat, typescript-eslint, eslint-plugin-vue) | ✅ 0 errors |
| Unit + DB + API tests | `npm test` | ✅ **221 / 221 passed** in 16 files (twice in a row, and from a freshly reset database) |
| Production build | `npx nuxt build` | ✅ 5.49 MB output; the built server was smoke-tested (13 routes 200/302, security headers, 401 on unauthenticated checkout) |
| UI validation | `npm run ui:shots` | ✅ 45 / 45 (15 screens × 1440/768/390): status, RTL, no overflow, no page errors — see `ui-validation/README.md` |
| Browser walk-through (customer) | `scripts/dev/e2e-commerce.mjs` (slice B) | ✅ login → cart → pledge → simulator → invoice → library → signed-URL download; 390 px overflow check |
| Browser walk-through (admin / affiliate) | slice C / D manual Chrome passes | ✅ 26 admin routes and 6 affiliate routes rendered with data, no console errors |

## Test files (passed/total)

| File | Tests | Covers |
|---|---:|---|
| `tests/db/rls.test.ts` | 23 | anonymous / customer / unrelated user / affiliate / admin privilege matrix, column grants, trusted-function execute rights, storage buckets, price constraints, role audit |
| `tests/db/commerce.test.ts` | 10 | `fulfill_payment` idempotency, amount mismatch, test-payment refusal, banned user, owned/free/draft rejection, order immutability, cross-user isolation |
| `tests/db/affiliate.test.ts` | 14 | single commission per order, freeze, self-referral, withdrawal minimum/balance/payout method, **concurrent withdrawals (one wins)**, append-only ledger, decisions, isolation, contributor approval once |
| `tests/db/comments.test.ts` | 5 | guest/banned cannot comment, moderation visibility |
| `tests/db/account.test.ts` | 3 | profile column grants |
| `tests/db/staging.test.ts` | 11 | legacy staging privacy, hash integrity, linking without re-upload |
| `tests/db/migration-import.test.ts` | 2 | catalog import of MOCK fixtures, idempotent re-run, cleanup |
| `tests/api/storefront.test.ts` | 21 | public pages, sitemap/robots, contact validation/honeypot/rate limit, view counter, legacy redirects |
| `tests/api/auth.test.ts` | 6 | registration → confirmation mail (Mailpit), unconfirmed login blocked, no self-promotion to admin |
| `tests/api/checkout.test.ts` | 15 | server-side pricing, session, simulator → entitlement → signed URL serving real PDF bytes, 401/403, public path closed, **webhook signature + replay**, wrong-amount webhook, simulator guard |
| `tests/api/affiliate.test.ts` | 11 | 401/403 matrix, withdrawal flow, payout validation, contributor upload validation, private documents, approval/decline |
| `tests/api/admin.test.ts` | 57 | every admin route 401/403/200, validation, sanitisation, hostile upload refusal (PHP/phar/MVG/HTML as .pdf/.png, oversize), soft delete/restore, audit rows, reports |
| `tests/unit/*` | 43 | Arabic normalisation, importer transforms (money, statuses, links), magic-byte/tar classifier with in-memory hostile fixtures |

## Defects the tests found (all fixed)
1. RLS policies on `book_media` and link tables sub-selected a non-granted column → permission denied for every public read (`rls.test.ts`).
2. `affiliate_balance()` lacked a `service_role` grant, and concurrent withdrawals could both pass the balance check (ledger visibility compared with transaction start time) — fixed by `20261110000100/0200`.
3. A production-only template compile error (`v-model="ref as never"`) that `nuxt dev` tolerated — found by `nuxt build`, 6 files fixed.
4. Honeypot input positioned at `left:-9999px` caused 9 600 px horizontal overflow in RTL — found by UI validation.
5. `purge_demo_data()` failed once demo books were purchased — now archives instead of deleting (`20261113…`).
6. Hydration mismatch on `/user-book` (loading condition differed server/client) — fixed.
7. Test-suite couplings (per-IP in-memory rate limiter, row selection by `limit(1)`) caused intermittent failures — tests made deterministic.

## Not tested / known gaps
* No automated accessibility run (axe/Lighthouse); no cross-browser run (Chrome only).
* No load/performance testing; no test of a multi-instance deployment (rate limiter is per instance).
* Real payment gateways, e-mail delivery to external providers and MFA enrolment cannot be tested (not implemented / no credentials).
* The importer's customer/financial loaders are covered by dry-run unit tests only; they have never run on a populated target because no dump exists.
* The shared dev database accumulates test residue (users from registration tests, soft-deleted `[test-d]` rows); `supabase db reset` + `npm run dev:seed` restores a clean state.
