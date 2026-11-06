# 04 — Authentication & permissions

## Authentication
* **Supabase Auth** (local GoTrue) with `@nuxtjs/supabase` cookie-based SSR sessions. Email + password; email confirmation is **on**
  (`supabase/config.toml`: `enable_confirmations = true`, min password length 8). Local mail is captured by Mailpit at
  http://127.0.0.1:54324.
* No password is generated, stored, or e-mailed by the application. The legacy guest-checkout behaviour (auto-created account with a
  plaintext password) is **dropped**; checkout requires a signed-in verified user.
* Cookies: `sameSite=lax`, `secure` in production (`nuxt.config.ts`).
* Rate limiting: login/signup/reset are throttled by GoTrue; the Nitro routes `contact`, checkout and downloads use `server/utils/rateLimit.ts`
  (in-memory, per instance — a shared store is an open item).

## Authorisation model

| Actor | How it is established | Can |
|---|---|---|
| anonymous | no session | read published catalog/CMS/public settings; download free + preview media (server decision); submit contact form |
| customer | Supabase session, `profiles.status = 'active'` | own profile (harmless columns), cart/checkout, own orders/entitlements/library/favourites/comments, contributor submission |
| affiliate | `profiles.is_affiliate = true` (set by server/admin only) | own commissions, ledger, payout methods, withdrawal requests |
| admin | row in `public.user_roles` (`role='admin'`), evaluated by `public.is_admin()` | everything under `/admin` — via Nitro routes that call `requireAdmin()` |
| server | service-role key (server runtime only) | privileged writes: orders/entitlements/commissions (`fulfill_payment`), withdrawals, approvals, uploads |

Rules that matter:
1. **Roles never come from `user_metadata`** (client-editable). `is_admin()` reads `user_roles`; it additionally requires `aal2` when `site_settings.require_admin_mfa` is on.
2. `status = 'banned' | 'review'` accounts cannot create payments (`create_payment_for_cart` refuses) and cannot comment (RLS check).
3. **No client write path to money.** `anon`/`authenticated` have *no* INSERT/UPDATE/DELETE on orders, order_items, payments, entitlements, commissions, ledger, withdrawals; `EXECUTE` on the trusted functions is revoked from `public/anon/authenticated`.
4. Admin catalog/CMS writes go through Nitro routes using the service client **after** `requireAdmin()`; the Data API grants give authenticated users *read* policies only (an admin may read drafts but cannot write directly — asserted by `tests/db/rls.test.ts`).
5. Private storage buckets have no policies at all; objects are reachable only via signed URLs created after a server-side entitlement/ownership check.

## Route protection

| Mechanism | Where |
|---|---|
| Route middleware `auth`, `guest`, `admin` | `app/middleware/` (UX redirect only — never the security boundary) |
| Server guard on every private API | `server/utils/supabase.ts`: `requireUser`, `requireAffiliate`, `requireAdmin` |
| Cache isolation | `nuxt.config.ts` `routeRules`: personalised areas `cache-control: private, no-store`; `/affiliate/**` and `/admin/**` are `ssr:false`; public pages render the logged-out header on the server and swap on the client after hydration |

## Local test identities (local only, throw-away)
`node scripts/dev/seed-dev.mjs` creates `admin@`, `customer@`, `customer2@`, `affiliate@`, `contributor@`, `banned@` `aawraq.test`
with the documented local password in the script. These exist only in the local Auth database.

## Verified by tests
`tests/db/rls.test.ts` (anonymous / customer / unrelated user / affiliate / admin matrix, column grants, storage buckets) plus the
slice suites listed in `09-testing-results.md`.
