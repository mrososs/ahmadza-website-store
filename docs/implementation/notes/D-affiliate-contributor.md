# Slice D — Affiliates & Contributors

Status: implemented and tested against local Supabase. Evidence labels as in `docs/legacy-audit`.

## Routes (UI)

| Route | Layout / guard | Legacy source |
|---|---|---|
| `/affiliate-register` | storefront | `affiliate/user/create.blade.php` |
| `/affiliate` (dashboard + referral link) | `affiliate` · `auth` · server `requireAffiliate` | `affiliate/user/dashboard` |
| `/affiliate/books` | same | `affiliate/user/book` |
| `/affiliate/profit` | same | `affiliate/user/profit` |
| `/affiliate/withdraw` | same | `affiliate/user/withdraw` |
| `/affiliate/withdraw-settings` | same | `affiliate/user/withdraw_type` |
| `/request-book`, `/user-book` | storefront · `auth` | `front/request-book`, `front/user-book` |
| `/admin/affiliates`, `/admin/affiliates/create`, `/admin/affiliates/[id]` | `admin` · `admin` | `affiliate/admin/*` |
| `/admin/withdraws` | `admin` | `affiliate/admin/withdraw` |
| `/admin/request-books`, `/admin/request-books/[id]` | `admin` | `admin/request-book/*` |

Affiliate/admin pages are `ssr:false` (client-rendered); pages never receive prices/balances from the client.

## Server API (`server/api/**`, all validated with zod, rate limited, authorised server-side)

| Route | Who | Notes |
|---|---|---|
| `GET /api/affiliate/program` | public | commission % from `site_settings` |
| `POST /api/affiliate/register` | active user | sets `profiles.is_affiliate` (constant `AFFILIATE_SELF_REGISTRATION` in `shared/constants/affiliate.ts`) |
| `GET /api/affiliate/summary` | affiliate | `affiliate_balance()` + stats + settings |
| `GET /api/affiliate/books` | affiliate | per-book attributed orders, per-sale commission |
| `GET/POST /api/affiliate/withdrawals` | affiliate | `request_withdrawal()` (locked, ledger-checked) |
| `GET /api/affiliate/withdrawals/:id/proof` | owner/admin | 302 to a 60 s signed URL |
| `PUT /api/affiliate/payout-methods` | affiliate | paypal / bank, per-kind zod |
| `POST /api/contributor/requests` | active user | multipart, magic-byte checks, private bucket |
| `GET /api/contributor/requests/:id/document/:kind` | owner/admin | 302 to a 60 s signed URL, others 403 |
| `GET /api/contributor/books` | user | own submissions + per-book views/purchases/gross |
| `GET/POST /api/admin/affiliates`, `GET/PATCH /api/admin/affiliates/:id` | admin | list, promote by e-mail, status |
| `GET /api/admin/withdrawals`, `POST …/:id/decision` | admin | paid (+proof) / rejected (JSON or multipart) |
| `GET /api/admin/request-books`, `GET …/:id`, `POST …/:id/decision` | admin | approve → ONE draft book (+PDF/cover copied), decline |

## Database (migrations `20261110000000…0200`)

* `payout_methods.is_active`; `private-sensitive` bucket raised to 100 MiB (book PDFs).
* Service-role-only functions: `find_user_id_by_email`, `admin_affiliate_overview`, `contributor_book_stats`.
* **Fixes to earlier migrations found by the tests** (kept additive):
  1. `affiliate_balance()` had no `service_role` grant (revoked from PUBLIC, never re-granted).
  2. **Concurrency bug**: ledger visibility used `now()` (transaction start) so a request that waited on the per-affiliate lock could not see the withdrawal hold written by the one it waited for → two concurrent withdrawals could both pass the balance check. Fixed: holds/debits are effective immediately, credits use `clock_timestamp()`; `request_withdrawal` also requires an **active** payout method.

## Business-rule coverage

| Rule | Decision | Implementation | Test |
|---|---|---|---|
| AFF-01 self-registration, instantly active | **Preserved** (default on, one constant to disable); activation only for ACTIVE accounts, via server route; no password generation | `register.post.ts`, `affiliate-register.vue` | api: "self-registration activates only active accounts" |
| AFF-02 attribution `?aff=` (session, last click) | **Changed**: first-party cookie 30 d (middleware by lead) read by checkout (slice B); self-referral and non-affiliate referrers ignored | `create_payment_for_cart` | db: "ignores self-referral and non-affiliate referrers" |
| AFF-03 attribution lost when webhook wins | **Fixed**: `payments.affiliate_id` stored at checkout | `fulfill_payment` | db: commission accrual |
| AFF-04 commission on gross, any mode | **Preserved on gross**; **test-mode commissions flagged `is_test`** and excluded from payable balance unless the local `allow_test_payments` switch is on; % and freeze days are `site_settings` values — **pending owner confirmation** | `fulfill_payment`, `affiliate_ledger` | db: "creates exactly one commission…", frozen |
| AFF-05 release via public GET, exact-date match | **Dropped/fixed**: no job; availability = `available_at <= clock_timestamp()` (catch-up by construction) | `affiliate_balance`, UI status badge | db: freeze assertions |
| AFF-06 withdrawal rules | **Preserved** (min, ≤ available, pending counted) + **fixed** race; decimals allowed (legacy: integers only); minimum is `site_settings` — **pending owner confirmation** | `request_withdrawal`, `withdraw.vue` | db: min/available/payout-method, concurrency, API validation |
| AFF-07 statuses / admin processing | **Preserved** (pending→paid/rejected, message, proof ≤ 2 MB pdf/png/jpg/webp). Rejection re-credits through an appended ledger entry; no mutable balance | `decide_withdrawal`, `admin/withdraws.vue` | db: paid vs rejected; api: decision + proof access |
| AFF-08 payout methods | **Preserved** (paypal/bank; `paypall` typo normalised); owner + admin read only; per-kind validation (legacy IBAN regex was unanchored). Field-level encryption **not done** (open item) | `payout-methods.put.ts`, RLS | db/api isolation |
| AFF-09 dashboard labels vs reality | **Fixed**: "الأرباح" = commissions, "الرصيد" = ledger-derived available; admin list shows real data (legacy hard-coded order count/date) | `summary.get.ts`, `admin_affiliate_overview` | api: summary |
| AFF-10 no clawback | **Unchanged** (no refunds exist); ledger supports `reversal` entries for later | — | — |
| ADM-17 public affiliate-crediting endpoint | **Dropped** (security) | — | — |
| ADM-18 admin affiliate management | **Preserved** (list, profile, status; create = promote existing customer, no mailed password) ; delete/restore replaced by status `banned` | `admin/affiliates/*` | api |
| CAT-28 request-book submission | **Preserved** fields/limits (docs ≤ 2 MB, book ≤ 100 MB, `share|rent`, agree). **Fixed**: only ACTIVE users; magic-byte validation; private bucket (legacy: public-capability URL); rate limit; no verified-e-mail gate (Supabase Auth confirms at sign-up). Phone libphonenumber/region validation **not** ported | `contributor/requests.post.ts`, `request-book.vue` | api: bad input, privacy |
| CAT-29 review/approval creates a Book | **Preserved**: approval creates exactly ONE **draft** book (owner = contributor) + one `after_purchase` media; cover copied to `public-media`; idempotent (second review → 409). Page count from the PDF **not** computed (pages = 0) | `approve_contributor_request`, `request-books/[id]/decision.post.ts` | db: approve once; api: approve + media row |
| CAT-30 owner revenue display | **Partially preserved**: views, purchases, **gross** sales per book. Legacy "net profit" (net_total × 0.8 for `share`) and download counter **not shown** — contributor settlement is not specified and none is invented (owner decision) | `contributor_book_stats`, `user-book.vue` | api: `/api/contributor/books` |
| Contributor e-mail on submission (RequestBookObserver) | **Not implemented** — no transactional mail provider yet | — | — |
| Sensitive docs privacy (RISK, docs/12) | **Fixed**: `private-sensitive` bucket, owner/admin signed URLs (60 s) | `[kind].get.ts` | api: owner 302, others 403, public URL ≠ 200 |

## Deviations from the legacy UI (documented, not silent)

* `/affiliate-register`: nickname and phone fields dropped (no profile data model for them; phone is editable in the profile). Registration uses Supabase Auth e-mail confirmation, so activation is a second step after confirming.
* `/user-book`: "صافى الربح" and "التنزيلات" tiles replaced/omitted as above; adds status + admin note per submission.
* Admin tables are plain tables (no DataTables client plugin); filter via `?status=`.
* `intl-tel-input` is not used (WhatsApp is a plain `tel` input).

## Tests

* `tests/db/affiliate.test.ts` — 14 tests: single commission/idempotent fulfilment, freeze, amount mismatch, self/non-affiliate referral, min/balance/payout method, **concurrent withdrawals (one succeeds)**, paid vs rejected, append-only ledger, cross-affiliate isolation, trusted functions not callable via Data API, `is_affiliate` not self-grantable, contributor approve-once / owner isolation.
* `tests/api/affiliate.test.ts` — 11 tests: 401/403 matrix, validation, withdrawal flow with proof, payout validation, self-registration, contributor upload validation (magic bytes), private documents, approval → draft book + media, decline.
* Run: `npm run test:db -- affiliate` and `npm run test:api -- affiliate` (needs `npm run dev` + `npm run dev:seed`). The API tests send a per-run `X-Forwarded-For` so the in-memory rate limiter does not trip across runs.
* Test data caveat: ledger/orders are append-only and `order_items` cannot be deleted, so tests use `[test-d]` books (archived afterwards) and assert deltas.

## Blockers / open items

1. Owner confirmation: commission %, freeze days, minimum withdrawal (`site_settings.pending_owner_confirmation`), self-registration policy, contributor settlement/“net profit” semantics, deal terms (`share`/`rent`).
2. No outbound e-mail (submission receipt, withdrawal decisions) — needs the transactional-mail outbox.
3. Payout details and IBAN are RLS-protected but not field-encrypted.
4. In-memory rate limiter is per instance (lead util).
5. `order_items_guard` blocks the FK `ON DELETE SET NULL` update, so a book referenced by any order cannot be deleted and `purge_demo_data()` will fail once demo books are purchased (lead to review; prefer archiving).
6. Hydration mismatch warning seen on `/user-book` for signed-in users (header auth state, default layout) and a 404 for `/assets/css/plugins/janna-bold.ttf` referenced by legacy `front.css` (file absent in the recovered tree) — both outside slice D.
