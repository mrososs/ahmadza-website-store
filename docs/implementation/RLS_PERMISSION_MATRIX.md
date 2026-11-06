# RLS & permission matrix

Verified against the **local** stack by `tests/db/rls.test.ts`, `tests/db/rls-ownership.test.ts`, `tests/db/commerce.test.ts`, `tests/db/affiliate.test.ts`,
`tests/db/comments.test.ts` and the HTTP suites. Hosted verification is pending access (`HOSTED_SUPABASE_SETUP.md`). RLS is enabled on **every** table in `public`
(audit query 1 returns 0 rows). Writes by end users are limited to the explicit exceptions in the last section; everything else is server-side only.

Legend: R = read, own = only rows owned by the caller, — = no access (RLS/grant denies), **server** = Nitro route with the service role after an explicit check or trusted SQL function.

| Data | anon | customer | affiliate | admin | Mutations |
|---|---|---|---|---|---|
| books, categories, makers, articles, pages (published/active) | R | R | R | R (+ drafts) | **server** (`requireAdmin`) |
| book_categories / makers / tags / relations | R (parent public) | R | R | R | **server** |
| book_media | R metadata + `migration_status` only; never key/provider/checksum/url | same | same | same via server | **server** |
| site_settings | R public subset (name, contact, branding, flags); not commission %, freeze days, MFA, payment mode | same | same | full via server | **server** |
| profiles | — | R/U own (display_name, phone, country, country_code, region only) | same | R all | status / is_affiliate / email: **server** |
| user_roles | — | R own row | R own row | R all | **server** only (audited) |
| comments | R approved + public-visible | + approved for books they own, + own | same | R all | insert own (pending, active accounts); moderation **server** |
| favourites | — | R/insert/delete own | own | — | direct, own only |
| contact_messages | — | — | — | R | insert **server** (rate-limited + honeypot); handling **server** |
| orders, order_items | — | R own | R own | R all | **only `fulfill_payment()`** (immutable afterwards) |
| payments | — | R own (no `raw_response`) | R own | R all | `create_payment_for_cart()` / `fulfill_payment()` / `fail_payment()` |
| payment_events | — | — | — | — | `register_payment_event()` (service role) |
| entitlements | — | R own | R own | R all | **only `fulfill_payment()`** |
| affiliate_commissions, affiliate_ledger | — | — | R own | R all | **only `fulfill_payment()` / `request_withdrawal()` / `decide_withdrawal()`**; ledger append-only |
| withdrawal_requests | — | — | R own (no proof path) | R all | `request_withdrawal()` / `decide_withdrawal()` |
| payout_methods | — | — | R/C/U/D own (affiliates only; `affiliate_id` cannot be moved) | R | direct, own only |
| contributor_requests | — | R own | R own | R all | submit **server**; `approve/decline_contributor_request()` |
| audit_log, migration_*, legacy_* | — | — | — | R | triggers / **server** |

## Function execute privileges
| Function | anon | authenticated | Note |
|---|---|---|---|
| `create_payment_for_cart`, `fulfill_payment`, `fail_payment`, `register_payment_event`, `request_withdrawal`, `decide_withdrawal`, `approve/decline_contributor_request`, `increment_view`, `increment_media_download`, `purge_demo_data` | ✗ | ✗ | `service_role` only |
| `is_admin`, `is_affiliate`, `owns_book` | ✗ (revoked in `20261114`) | ✓ | answer only about the caller; evaluated as `(select …)` initplans in policies |
| `affiliate_balance(uuid)` | ✗ | ✓ | refuses unless caller = affiliate, admin or service role |
| `book_comments(bigint)`, `site_totals()` | ✓ | ✓ | intentional public RPCs: approved-comment listing / aggregate counters |
| `private.is_public_book(bigint)` | policy-only | policy-only | lives in the non-exposed `private` schema (not callable through the Data API; tested) |
| trigger functions | ✗ | ✗ | not executable by API roles |

## Column-level privacy
`books.owner_id`, `books.legacy_cost_raw`, `book_media.storage_path|external_url|sha256|legacy_path|mime_type|storage_provider`, `payments.raw_response`,
`site_settings` commercial columns, `withdrawal_requests.proof_path` are **not granted** to `anon`/`authenticated` (a SELECT naming them fails with 42501; tested).

## Intentional user write paths (the only ones)
`favourites` (insert/delete own), `comments` (insert own, forced `status='pending'`), `profiles` (5 harmless columns), `payout_methods` (own, affiliates).
Everything that touches money, ownership, entitlements, roles, uploads or settings goes through server code.

## Findings log (`npm run audit:db` = `scripts/db/audit-security.sql`)
| Check | Result after `20261114` |
|---|---|
| RLS disabled tables | 0 |
| functions without pinned `search_path` | 0 |
| unindexed foreign keys | 0 (22 fixed) |
| multiple permissive policies (same role+action) | 0 (7 merged) |
| per-row `auth.*()` / `is_admin()` calls in policies | 0 (wrapped in `select`) |
| SECURITY DEFINER exposed to API roles | 8 reviewed & intentional (table above) |
Supabase's own Security/Performance **advisors have not been run** against the hosted project (no access). The leaked-password-protection and SMTP/rate-limit items are dashboard settings listed in `AUTH_INTEGRATION.md`.
