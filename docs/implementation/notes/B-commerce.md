# Slice B — customer commerce (cart, checkout, library, account)

## Routes
| Route | File | Notes |
|---|---|---|
| `/cart` | `app/pages/cart.vue`, `app/composables/useCheckout.ts`, `app/components/cart/CartModal.vue` | ids-only Pinia cart; server quote; login-in-place; pledge gate |
| `/checkout/simulate/[reference]` | `app/pages/checkout/simulate/[reference].vue` | DEV simulator UI with an unmistakable banner |
| `/checkout/return` | `app/pages/checkout/return.vue` | polls the owner's payment row (RLS), redirects to the invoice |
| `/library` | `app/pages/library.vue`, `components/account/LibraryBookCard.vue` | own entitlements; `تجريبي` badge for `is_test` |
| `/favourites` | `app/pages/favourites.vue` | tabs books/articles, remove |
| `/invoices`, `/invoice/[orderNo]` | `app/pages/invoices.vue`, `app/pages/invoice/[id].vue` | invoice number = `orders.order_no` |
| `/update-profile` | `app/pages/update-profile.vue` | RLS column grants; password via Supabase Auth |

## API (Nitro)
`POST /api/cart/quote` · `POST /api/checkout/session` · `POST /api/checkout/simulate/[reference]` · `POST /api/webhooks/payments/[provider]` · `GET /api/library/download/[mediaId]`
Services: `server/services/payments/{types,dev-simulator,gateways,index}.ts`. Schemas: `shared/schemas/commerce.ts`. Queries: `shared/queries/commerce.ts`.
Migration: `20261108000000_commerce_helpers.sql` (`increment_media_download`, service_role only).

## Business-rule coverage
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

## Deviations / notes
- Guest checkout is replaced by sign-in/registration (no auto-created accounts).
- Affiliate attribution is read from the `aw_aff` cookie by the server (never the body).
- `tests/helpers/supabase.ts` `apiAs()` now merges extra cookies (additive fix). `tests/helpers/commerce.ts` holds fixtures.
- Pages that need the session are client-fetched (`server:false`) so nothing personalised is SSR-cached.
- Library only shows books still published (RLS hides archived/deleted books from the embed).
- `scripts/dev/e2e-commerce.mjs` = browser walk-through (set `PW_CHROMIUM` if `npx playwright install` has not matched the library version).

## Blockers / not done
- Paymob / Tap not integrated (no authorised credentials) → 501; signature design documented in `gateways.ts`.
- E-mail receipts/outbox, refunds, FX conversion not built.
- In-memory rate limiter is per instance.
