# Payments: what is built, what is proven, and the exact steps to enable real purchases

Status on 2026-11-06: Paymob and Tap are **fully implemented and contract-tested against mock gateways. Neither is verified against a real gateway**, because no authorised merchant credentials exist. Live charging is off and cannot be switched on by accident.

## 1. What the legacy store did (from the recovered Laravel code; nothing copied, no keys reused)

| Question | Evidence | Where it went |
|---|---|---|
| Default provider | Paymob KSA, `PAYMENT_PROVIDER` defaulted to `paymob` | Paymob is first in the provider order and the default |
| Second provider | Tap, kept as an alternate. Whether it was ever live is **unknown** | Implemented as the alternate |
| Paymob flow | Intention API, Unified Checkout redirect, redirect and webhook callbacks, HMAC-SHA512 over 20 fields, amount and currency compared with the stored row | Same flow, field list re-checked against the current docs (identical) |
| Tap flow | Card tokenised in the browser by Tap's JS SDK, then a charge; the callback had **no** signature, safety was a server-side re-fetch of the charge | Provider-hosted page instead (no card data touches the app); the documented `hashstring` signature is checked **and** the charge is re-fetched |
| Currency | Catalogue price in USD; the charge currency came from `PAYMENT_CURRENCY` / `PAYMENT_CART_CURRENCY` and an `PAYMENT_EXCHANGE_RATE` (default 1). **Which values production used is unknown** | **No conversion is ever applied.** The charge currency is the store currency. See section 5 |
| Legacy weaknesses | a callback was matched to a payment by an unsigned reference; the failure record was rolled back with the transaction; order e-mail sent inside the transaction | Fixed: callbacks bind to the gateway-signed order id; failures are recorded; settlement is one database function |

## 2. What is implemented

* Provider interface: create a hosted session, verify a callback signature, re-confirm with the gateway API (Tap), verify the browser return, normalise to one event. Paymob and Tap adapters, plus the development simulator.
* Settlement (`server/services/payments/settle.ts`) is the only path from a gateway event to an order. It is idempotent: the payment row is locked, a replay returns the same order, every distinct gateway event is recorded once, the amount and currency the **gateway** reports are compared in SQL with the stored payment, and entitlement and affiliate commission are created in the same transaction.
* Money that cannot be fulfilled automatically (captured after the payment failed or expired, a different amount or currency, an event signed with the wrong key set, a refund after fulfilment) is **never dropped**: the payment is flagged **needs review** and shown to the admin; the gateway still gets a 200 so it stops retrying.
* A test key can never settle a live payment and the reverse.
* Stored payloads are a whitelisted subset: no card digits, no billing or customer data.
* Admin: gateway status panel (variable **names** only, never values; NOT VERIFIED badge; webhook URLs) and a "needs review" filter on the payments list.
* Storefront: payment method choice that follows what the server says is available; clear unavailable states; the protected preview switches checkout off entirely.

## 3. Evidence (all against mocks; none against a real gateway)

* `tests/unit/payments-paymob.test.ts`, `payments-tap.test.ts`: signature layout (Paymob's string is checked against the **worked example printed in Paymob's docs**), tampering, wrong key set, success rules, request bodies, redaction, availability gates.
* `tests/db/payments-hardening.test.ts`: twenty simultaneous callbacks create one order, one entitlement, one commission; replays; binding; review flag; privileges.
* `tests/api/payments-gateways.test.ts`: a real server against a mock Paymob and Tap: sessions priced from the database, signed webhooks, Tap's API re-fetch, browser return, concurrency, tampering, key-mode isolation, late and mismatching captures, reversals, no leakage of gateway error text.
* The end-to-end test found a real defect that unit tests could not: Nuxt turns `NUXT_PAYMOB_LIVE_INTEGRATION_IDS=9001` into a number, which an earlier version silently dropped. Fixed and covered.

## 4. Things only a real sandbox run can confirm (do these first)

These are points the public documentation leaves open or that the adapters had to infer. Each has a deliberately safe failure mode (the payment stays pending or is flagged, never wrongly fulfilled).

| # | Open point | Where it matters | Safe failure |
|---|---|---|---|
| 1 | Paymob: the Create Intention response field `intention_order_id` is the same number as `obj.order.id` in the callback | callbacks are bound to it | the session is refused if the id is absent; a mismatch makes callbacks 404 and the payment stays pending |
| 2 | Paymob: `special_reference` comes back as `obj.order.merchant_order_id` (the docs say so; their sample shows `null`) | convenience check only; binding does not depend on it | none needed |
| 3 | Paymob: which `billing_data` keys are mandatory beyond `phone_number` (legacy sent first/last name, email, phone, country, city, street, building, floor, apartment, placeholder `NA`) | session creation | the gateway rejects with 400, the customer sees "could not start payment", no payment is left pending |
| 4 | Paymob: the redirect (GET) callback names the order key `order_id` (docs) or `order` (accepted too) | browser return only | the result page waits for the webhook |
| 5 | Paymob: the transaction inquiry endpoint was not found in the public docs, so **no inquiry re-check is performed for Paymob**: it relies on the HMAC (which covers amount, currency, order id, status flags) | defence in depth | n/a |
| 6 | Tap: the exact text form of the amount inside the `hashstring` (docs show no worked value). Three forms are accepted (fixed decimals, JSON number, exact text) | webhook signature | a valid webhook could be rejected with 401; Tap's retry and the browser return still settle it via the API re-fetch |
| 7 | Tap: the `tap_id` query value on the redirect equals the `chg_` id | browser return | the page waits for the webhook |
| 8 | Tap: retry policy of the webhook (not documented) | late settlement | the browser return and a manual reconcile cover it |
| 9 | Both: which currencies the merchant account and integration accept | section 5 | the gateway rejects the session |
| 10 | Apple Pay: whether the legacy Apple Pay integration id was set (unknown) | Paymob `payment_methods` | only the integration ids you list are offered |

## 5. Owner decisions that cannot be inferred

1. **Currency (USD is preserved; nothing is converted).** The store currency is USD, as in the original store, and stays USD unless verified business records say otherwise. Neither provider's public documentation lists which currencies a regional account can charge, or says whether a KSA account can charge USD (checked 2026-11-07). What the docs do say: Paymob requires the request currency to match the currency of the integration id, and Paymob accounts are regional ("no global account"). So the platform makes **you confirm it in configuration**: a gateway stays **unavailable** until `NUXT_PAYMOB_CURRENCY` / `NUXT_TAP_CURRENCY` is set to the currency your account really charges in, and that value must equal the store currency (USD). If your Paymob KSA integration is SAR, it stays unavailable (the admin panel says why). Your options then: obtain a USD-capable integration or merchant account from the provider, or change the store currency in site settings to the account's currency (every price is then read in that currency). Ask the provider in writing before you choose.
2. Whether Tap is wanted at all (it may never have been live).
3. Refunds: handled in the gateways' own dashboards. A refund or void reported after fulfilment flags the payment; it does not revoke the library entry automatically.

## 6. Configuration (server-only environment; nothing is read from the database or sent to the browser)

| Variable | Meaning |
|---|---|
| `NUXT_PAYMENTS_ENABLED_PROVIDERS` | which providers may be offered. Production default `paymob,tap` |
| `NUXT_PAYMENTS_PUBLIC_BASE_URL` | the **public https origin** the gateways call back to (they cannot reach localhost) |
| `NUXT_PAYMENTS_LIVE_ENABLED` | the owner's explicit live switch. Default false |
| `NUXT_PAYMOB_TEST_SECRET_KEY`, `_PUBLIC_KEY`, `_HMAC_SECRET`, `_INTEGRATION_IDS` (comma list) | Paymob sandbox set |
| `NUXT_PAYMOB_LIVE_SECRET_KEY`, `_PUBLIC_KEY`, `_HMAC_SECRET`, `_INTEGRATION_IDS` | Paymob live set |
| `NUXT_PAYMOB_REGION` (`ksa` default, `egypt`, `uae`, `oman`: selects the regional base and checkout hosts), `NUXT_PAYMOB_BASE_URL` / `NUXT_PAYMOB_CHECKOUT_URL` (optional overrides), **`NUXT_PAYMOB_CURRENCY` (required confirmation, must equal the store currency)**, `NUXT_PAYMOB_FALLBACK_PHONE`, `NUXT_PAYMOB_VERIFIED` | region, currency confirmation, tuning and attestation |
| `NUXT_TAP_TEST_SECRET_KEY`, `NUXT_TAP_LIVE_SECRET_KEY`, `NUXT_TAP_MERCHANT_ID` (optional), `NUXT_TAP_BASE_URL` (default `https://api.tap.company/v2`), **`NUXT_TAP_CURRENCY` (required confirmation, must equal the store currency)**, `NUXT_TAP_VERIFIED` | Tap |

The active key set follows the **payment mode** in site settings (test or live). Test payments additionally need `allow_test_payments` in site settings.

## 7. Configure the merchant sandbox accounts (exact steps), then test (no real money)

Do this in your own provider dashboards. Nothing here uses, or needs, any key from the legacy code (treat those as exposed and never reuse them). Values go into the **server environment** of a deployment, never into the repository, a chat or a screenshot.

### Paymob (sandbox)
1. Sign in to the Paymob dashboard of the **region your account was opened in** (KSA: `ksa.paymob.com`; the other regions use their own host; accounts are regional, there is no global account). Switch the dashboard to **Test** mode.
2. Developers, Payment Integrations: create or open an **online card** integration in Test mode. Note its **Integration ID** and the **currency shown for it**. That currency is what you confirm below; it must be USD to be used with this store. If it is not USD, stop and ask Paymob for a USD integration (the docs do not say whether your region allows it).
3. Developers, API/credentials: copy the Test **Secret Key** (`egy_sk_test...` style prefix varies by region), the Test **Public Key** and the **HMAC secret** (Settings, Account Info). Keys and integration ids are mode-specific: the table refreshes when you switch Test/Live.
4. Environment variables (sandbox deployment only):
   ```
   NUXT_PAYMENTS_ENABLED_PROVIDERS=paymob
   NUXT_PAYMENTS_PUBLIC_BASE_URL=https://<sandbox deployment origin>
   NUXT_PAYMOB_REGION=ksa                      # ksa | egypt | uae | oman
   NUXT_PAYMOB_CURRENCY=USD                    # ONLY if step 2 showed USD
   NUXT_PAYMOB_TEST_SECRET_KEY=...
   NUXT_PAYMOB_TEST_PUBLIC_KEY=...
   NUXT_PAYMOB_TEST_HMAC_SECRET=...
   NUXT_PAYMOB_TEST_INTEGRATION_IDS=<id>[,<id>]
   ```
5. Test cards and test wallet: Paymob's page "Test credentials" (`developers.paymob.com`, under Need Help, FAQ). Use only Test mode credentials with Test keys.

### Tap (sandbox)
1. Sign in to the Tap dashboard (`os.tap.company`), Accounts, open the ID under **Operators**, **MERCHANT** section: copy the default **Test Secret Key** (keep the secret key on the server; the public key is not used by this integration).
2. Find out from Tap which currencies your merchant account can charge (the public docs do not list them, nor whether a Saudi account can charge USD). The currency you confirm below must be USD to be used with this store.
3. Environment variables (sandbox deployment only):
   ```
   NUXT_PAYMENTS_ENABLED_PROVIDERS=tap
   NUXT_PAYMENTS_PUBLIC_BASE_URL=https://<sandbox deployment origin>
   NUXT_TAP_CURRENCY=USD                       # ONLY if Tap confirmed your account charges USD
   NUXT_TAP_TEST_SECRET_KEY=...
   # NUXT_TAP_MERCHANT_ID=...                  # optional
   ```
4. Test cards: Tap's "Testing cards" page (`developers.tap.company/reference/testing-cards`). In test mode the source is not charged.

### Sandbox deployment and test run
1. The gateways must reach your webhook and redirect URLs, so the sandbox deployment needs a public **https** origin (set `NUXT_PAYMENTS_PUBLIC_BASE_URL`). A protected preview blocks the webhook endpoint by design, so use a **separate, short-lived sandbox deployment** (or open the preview for the duration of the test with `NUXT_PREVIEW_MODE=open` and live mode off). Test payments also need `allow_test_payments` in site settings (admin) and the payment mode `test`.
2. In the admin payments page the gateway panel must say "ready" (not "unavailable"), NOT VERIFIED, with the webhook URL shown. A gateway that is not ready is never offered to customers.
3. Register dashboard-level callbacks only if you want a fallback (sessions already send per-payment notification and redirect URLs): Paymob "Transaction processed callback" and "Transaction response callback" to the URLs shown in the panel; Tap needs nothing.
4. Buy a book with the providers' **test cards**. For each gateway verify: a successful payment creates one order and one library entry; a declined card does not; closing the browser before the redirect still settles via the webhook; resending the same webhook does nothing; a refund made in the dashboard shows up as **needs review**. Work through section 4 and record the answers.

## 8. Enable real purchases (only after section 7 passes for the gateway)

1. Decide the currency (section 5) and confirm prices.
2. Ensure at least one **validated book file** exists for each book you sell (a paid book without a deliverable file should not be published).
3. Live credentials go in the server environment. Set `NUXT_PAYMOB_VERIFIED=true` (or `NUXT_TAP_VERIFIED=true`): your written attestation that the sandbox run passed.
4. Set `NUXT_PAYMENTS_LIVE_ENABLED=true`, then switch the payment mode to **live** in site settings. Both are required; either alone keeps live refused.
5. Remove preview protection only when you intend the site to be public (`NUXT_PREVIEW_MODE=open`).
6. Make one small real purchase yourself and refund it in the gateway dashboard. Watch the payments page: the refund should appear as **needs review**.
7. Rollback: switch the payment mode back to test, or unset `NUXT_PAYMENTS_LIVE_ENABLED`. New sessions stop immediately; verified callbacks for payments already taken are still settled.

## 9. Operating

* **Needs review** (admin payments, filter): read the reason, check the payment in the gateway dashboard, and refund or fulfil by hand. Fulfilment by hand must go through the database function, never by editing rows.
* Reconciliation: compare the admin payments list with the gateways' settlement reports. A pending payment older than 30 minutes is marked abandoned in the list.
