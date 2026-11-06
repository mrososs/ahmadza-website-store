# 06 — Business-rule coverage

Every preserved, fixed or dropped legacy rule is mapped to its implementation and test. Rule IDs come from
`docs/legacy-audit/11-business-rules-catalog.md` (155 rules). Status words: **preserved** (same behaviour), **fixed** (legacy defect
corrected), **changed** (deliberate deviation), **dropped** (defect or dead code not carried over), **not implemented** (documented blocker).
The tables below are compiled from the per-slice notes in `docs/implementation/notes/` (the authoritative detail lives there).
Test file names refer to `tests/api`, `tests/db` and `tests/unit`.

## A. Storefront & authentication

| Rule | Status | Implementation | Test |
|---|---|---|---|
| AUTH-02 registration validation | preserved (zod + Supabase min length 8) | `pages/register.vue`, `shared/schemas` | `tests/api/auth.test.ts` |
| AUTH-04 / AUTH-09 verification | fixed — confirmation e-mail now sent, login blocked until confirmed | `pages/register.vue`, `pages/confirm.vue` | auth.test (Mailpit, `email_not_confirmed`) |
| AUTH-05 login | preserved on Supabase Auth | `pages/login.vue` | auth.test |
| AUTH-07 e-mail oracle | fixed (no enumeration) | register/forgot pages | auth.test (recovery) |
| AUTH-12 password reset | replaced by Supabase recovery link | `forgot-password.vue`, `reset-password.vue`, `confirm.vue` | auth.test |
| AUTH-16/22 admin role | fixed — `user_roles`, never user metadata | `middleware/admin.ts` | auth.test (self-promotion refused) |
| CAT-03/04 status & visibility | preserved; drafts/archived 404 | `getBook`, RLS | storefront.test |
| CAT-06/08 categories & makers | preserved (links in book page, `/search?category`) | `pages/book/*`, `maker/*` | storefront.test |
| CAT-15/16 media gate, preview | preserved in UI; enforcement in slice B route | `pages/book/*` | (slice B) |
| CAT-21 related books | preserved as data (semantics pending owner) | `relatedBooks` | — |
| CAT-23 search | preserved (title, Arabic-normalised) | `BookListing`, `listBooks` | storefront.test |
| CAT-24 view counting | preserved, atomic + rate limited | `api/views` | storefront.test |
| CAT-25 comments | preserved: pending moderation, buyers see all | `book_comments`, book page | `tests/db/comments.test.ts` |
| CAT-27 favourites | preserved (RLS-owned) | `useFavourite` | (RLS in foundation) |
| CAT-31 contact | preserved + honeypot + rate limit | `api/contact.post.ts` | storefront.test |
| CAT-32/33 articles/pages | preserved, HTML sanitised on save (slice C) | `post/*`, `p/*` | storefront.test |
| CAT-36 URL ids | replaced by numeric ids + 301s | `product/`, `article/` | storefront.test |
| CAT-37 statistics | preserved (foundation) | — | — |

## B. Cart, checkout, payments, library

| Legacy rule | Decision | Implementation | Test |
|---|---|---|---|
| ORD-01 session cart | preserved (client list of ids; no prices) | `stores/cart.ts` | e2e script |
| ORD-02 add-to-cart ignores type | fixed — only published paid books are sellable | `cart/quote.post.ts`, `create_payment_for_cart` | `tests/api/checkout.test.ts` (quote), `tests/db/commerce.test.ts` |
| ORD-03 server-side price | preserved & enforced | quote + `create_payment_for_cart` | forged `price/total` ignored (api test) |
| ORD-04 re-purchase of owned items | fixed — refused (`already in the library`) | `create_payment_for_cart`, quote `owned[]` | db + api tests |
| ORD-05/AUTH-08 silent guest account + plaintext password | dropped — account required, no password generated/mailed | `cart.vue` (login modal + register link) | — |
| ORD-06 email-probe endpoint | dropped (enumeration oracle) | — | — |
| ORD-07 currency/FX | not implemented — single base currency; `fx_rate` column kept (pending owner, Q-C) | `payments.fx_rate` | — |
| ORD-08 no tax/fee/coupon to buyer | preserved | total = Σ unit prices | db test (sum) |
| ORD-09 pledge gate | preserved | `cart.vue` `#agree_deal_pay_modal` | `scripts/dev/e2e-commerce.mjs` |
| ORD-10/PAY-07 order only after verified payment | preserved, one path | `fulfill_payment()` via simulate/webhook | api tests (no order before payment) |
| ORD-11 idempotency | preserved: row lock + `provider_transaction_id` UNIQUE + `payment_events` | `fulfill_payment`, webhook route | db idempotency, webhook replay x4, concurrent double-click |
| ORD-13 frozen amount | preserved (`payments.amount` = `orders.total_amount`) | `fulfill_payment` | db |
| ORD-14/15, AUTH-18 invoice ownership | preserved via RLS (owner/admin) | `orders_own_read`, `/invoice/[id]` | `tests/db/commerce.test.ts`, `account.test.ts` |
| ORD-16 library = own paid orders | preserved via `entitlements` | `/library` | account test, e2e |
| ORD-17/AUTH-19 file access gate | rebuilt: private bucket, short-lived signed URL, 401/403 | `library/download/[mediaId].get.ts` | api tests (401/403/302, PDF bytes, public path blocked) |
| ORD-18 free books have no acquisition record | preserved — free files open to guests | download route | api test |
| ORD-12 per-line internal fees | columns kept, not computed for new orders (reporting only; owner to confirm) | `order_items` | — |
| ORD-19 sync e-mails in transaction | deferred: outbox not built (blocker) | — | — |
| PAY-01 one active gateway | `runtimeConfig.paymentProvider` | `payments/index.ts` | — |
| PAY-02 test/live mode | `payments.mode`; simulator forced `test` (CHECK) | DB + provider | db test (CHECK), api guard test |
| PAY-03 payment row before gateway | preserved | `create_payment_for_cart` | api test |
| PAY-04..06 gateway verification | designed, **not implemented** (501 stubs) | `payments/gateways.ts` | api test (501) |
| PAY-08 failures leave no trace | improved: payment row marked `failed`, no order | `fail_payment` | api test |
| Test orders granting access/commission (risk) | fixed: test payments refused unless `allow_test_payments`; entitlements flagged `is_test`, UI badge | `fulfill_payment` | db + api tests |

## C. Administration

| Rule | Decision | Implementation | Test |
|---|---|---|---|
| ADM-01 user list/filters | preserved | `users/index.get.ts`, `admin/users/index.vue` | admin.test "users…" |
| ADM-02 change user status | preserved (+ admin cannot change own status) | `users/[id].patch.ts` | admin.test "users…" |
| ADM-03 user details | preserved | `users/[id].get.ts`, `users/[id].vue` | authorisation matrix |
| ADM-04 dashboard | preserved with real queries; revenue = live paid only | `dashboard.get.ts` | authorisation matrix |
| ADM-05–08 reports | preserved (users, books, orders, revenue); legacy per-line fee columns exist only on imported history, not recomputed | `stats/[kind].get.ts` | "reports" |
| ADM-09 Excel export | changed to CSV (formula-safe) | same | "reports" |
| ADM-10 site settings | preserved; ranges validated (legacy accepted negatives / >100 %); commercial values flagged pending owner | `settings/*`, `site-info.vue` | "settings" |
| ADM-11 settings effect | public subset readable via column grants (migration 4) | — | RLS tests (lead) |
| ADM-12/13 backup UI | dropped here (infra: Supabase backups) — documented in remaining blockers | — | — |
| ADM-14 notify queue | dropped (dead code in legacy) | — | — |
| ADM-16 contact inbox | preserved (handled flag, delete) | `contacts/*` | "contacts and comments" |
| ADM-17 public affiliate-release GET | dropped (security) | — | — |
| ADM-18 admin affiliate management | slice D | — | — |
| CAT-01/02/03 price type, USD, status | preserved; status enum draft/published/coming_soon/archived; free ⇒ price 0 | `adminBookSchema`, DB check | "books CRUD" |
| CAT-06/08 categories, makers & roles | preserved (link tables) | `adminBooks.ts#syncRelations` | "books CRUD" |
| CAT-10 cover processing | changed: type/size validation, no server-side resize (documented) | `images/[entity]/[id].post.ts` | "cover upload" |
| CAT-11/12 media types, upload rules | preserved; visibility enum replaces `is_free` 0/1/2; legacy 100 MiB limit now enforced | `books/[id]/media/index.post.ts` | "accepts a real PDF…", "refuses hostile payloads" |
| CAT-13 PDF page counting | preserved (approximate regex count) | `countPdfPages` | "accepts a real PDF…" |
| CAT-14 external URLs | preserved, https only | `adminExternalMediaSchema` | "external media must be https" |
| CAT-18/19 soft delete / restore | preserved; legacy "mail every buyer all files" side effect **dropped** | `books/[id].delete.ts`, `restore.post.ts` | "creates a book…" |
| CAT-20 clone | preserved for metadata/relations as a DRAFT; media files are not copied (legacy collisions) | `cloneBook` | "creates a book…" |
| CAT-21 related books | preserved as data (semantics pending owner) | `book_relations` sync | "books CRUD" |
| CAT-25 comment moderation | preserved | `comments/*` | "contacts and comments" |
| CAT-32/33 articles, pages | preserved, sanitised, soft delete | generic entity routes | "rich text is sanitised" |
| CAT-34 public editor upload | dropped; admin-only upload route with allow-list | `images/…` | upload tests |
| CAT-39/40 unauthenticated mass-mail / state-changing GETs | dropped; all mutations are POST/PUT/PATCH/DELETE behind `adminWrite` | — | write-closed matrix |

## D. Affiliates & contributors

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

## E. Historical data & platform (INT-*, data rules)

See `07-historical-data-import.md` (data availability, importer, media pipeline) and `08-security-decisions.md` (INT/security rules).
Tests: `tests/unit/migration-*.test.ts`, `tests/db/staging.test.ts`, `tests/db/migration-import.test.ts`, `tests/db/rls.test.ts`.

## Not covered (explicitly out of scope or blocked)

| Rule family | Reason |
|---|---|
| PAY-04…PAY-06 live gateway verification (Paymob/Tap) | no authorised sandbox credentials; design in `server/services/payments/gateways.ts`; stubs return 501 |
| ORD-07 currency conversion | gateway/FX rate unknown (owner question Q-C); single base currency modelled |
| ORD-19 e-mail on order | transactional-mail outbox not built |
| ADM-12/13 backups | infrastructure concern (Supabase backups) |
| INT-* monitoring (Sentry/Telescope) | deliberately not carried over; observability to be chosen at deployment |

_Compiled rows: 85._
