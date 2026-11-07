# AAWRAQ release acceptance report

Date 2026-11-07. Branch `vps-recovery-prep` (`git log --oneline main..HEAD` lists its commits). **Not merged, not pushed, not deployed.** Every figure below comes from a run on the committed code in this session; nothing is counted that was not executed and passed.

## 1. Gates

| Gate | Result |
|---|---|
| ESLint (`eslint .`) | clean |
| Type checks, `vue-tsc` on app, server, node, shared | 0 errors on all four (a vue-router volar plugin-path warning is printed; tooling noise, exit 0) |
| Vitest (unit, API, RLS and database tests, local stack) | **45 files, 593 tests, all passed** |
| Playwright (real Chrome, one worker, one spec file at a time) | **224 executed, 224 passed, 0 failed, 0 skipped** (table below) |
| Production build (`nuxt build`, hosted layer) | success in 24.7 s; **no shared-cache route rules** in the output |
| Database audit (`npm run audit:db`) | 8 findings, **all reviewed and allowed, 0 unexpected** |
| Hosted Supabase (`ubjuyeccioflhpcpnhmo`, read-only checks) | 19/19 migrations, schema fingerprints identical to local, advisors without errors, hosted suites passing, catalogue tables empty |
| Secret and private-file scan of `main..HEAD` | clean (`RELEASE_PREPARATION.md`) |

| Playwright spec | Tests | Passed |
|---|---|---|
| `admin-mfa-ui` (password, then TOTP code) | 2 | 2 |
| `hydration` | 16 | 16 |
| `recovery-ui` | 15 | 15 |
| `review-queue` | 2 | 2 |
| `ui-validation` | 45 | 45 |
| `ui-refinement` | 55 | 55 |
| `admin-sweep` (every admin page, 1440 and 390 px, forms, moderation, 50 malformed writes) | 38 | 38 |
| `journeys` (customer, library, free claim, admin lifecycle, cart) | 42 | 42 (39 on the first run; the 3 purchase-journey runs failed on a stale assertion and passed after it was corrected, see below) |
| `preview-production` (production build, protected preview, real browser) | 9 | 9 |

How the run went, so nothing is overstated:
* The first attempt to run all 224 in one command was stopped by the host when memory ran critically low, after 4 tests. It was **not** counted. The totals above are from separate, memory-gated runs after that.
* The 3 journey failures were a test still expecting the old behaviour (an unusable gateway shown as a disabled radio). The requirement is that checkout never shows an unusable method, so the assertion now expects none. This is a test update to the stated requirement, not a loosened check.
* `ui-validation` and `ui-refinement` rewrite tracked screenshots; those generated files were restored, so they are not part of any commit.
* The preview acceptance ran against a **local production build** on `127.0.0.1:3300` over plain http with a throw-away password, not on a hosting platform. There is no AAWRAQ hosting project yet.

## 2. Status in six categories

### Ready for client preview
* The protected-preview build and its configuration. Anonymous visitors get 401 with no application bytes, `noindex` and `no-store` everywhere (including errors); wrong user or password is refused; with the password the storefront renders Arabic RTL without hydration errors, canonical URLs exist, an unknown book is a non-cacheable 404, `/admin` leads to the login; checkout, payment webhooks and downloads answer 503; the admin API still demands an administrator session. No synthetic data appears. Verified 9/9 in a real browser at 1440 and 390 px.
* A protected build carries no shared-cache rules, and refuses to start on Vercel if it ever did (the cache would bypass the password gate).
* **Not yet deployed.** Needs the hosting project and your secrets (section 3).
* The hosted catalogue is empty, so a first preview shows an empty storefront until recovered drafts are reviewed and published.

### Ready for administrator use
* Dashboard, books (create, edit, media, clone, trash, restore), catalogue recovery with a review queue, categories, authors, articles, pages, users, orders and invoices, payments, affiliates, withdrawals, contributor requests, comments, contacts, statistics with CSV export, site settings, MFA. All visited at both widths with no dead button, broken navigation, server error or sideways scroll.
* Fixed during the sweep: Arabic validation messages; `javascript:`/`data:` links refused in social settings; duplicate slug is a 409 instead of a 500; a page past the end of a list is a 404; orders search no longer returns everything for a non-numeric term; empty states; phone layout; the MFA page is reachable from the menu.
* Needs before use: your administrator e-mail invited with `scripts/admin/bootstrap-admin.mjs`, the authenticator enrolled at `/admin/security`, and SMTP (`AUTH_PREVIEW_AND_SMTP.md`).
* Not exercised on purpose: logout, MFA enrolment and demo-data purge (shared state), withdrawal approve/reject (append-only ledger; the modal was tested), any real payment.

### Awaiting real merchant credentials
* Paymob and Tap are implemented against their current official documentation (HMAC-SHA512 over the 20 documented fields, verified with the official worked example; Tap `hashstring` plus a charge re-fetch), settled through one idempotent path, bound to the gateway-signed order, with redacted stored payloads and a needs-review queue.
* **Both stay off** and are not offered at checkout: a gateway is usable only when sandbox credentials exist, the merchant currency is explicitly confirmed and matches the store, test payments are enabled, and (for live) `NUXT_PAYMENTS_LIVE_ENABLED` plus `NUXT_<PROVIDER>_VERIFIED` are set.
* **USD is the catalogue currency and is never converted silently.** The providers' public documentation does not list which currencies a merchant account can charge, so this needs the owner's confirmation with each provider. The config reports every unsupported or unconfirmed combination with its reason.
* Exact sandbox steps and variable blocks: `PAYMENTS_GO_LIVE_CHECKLIST.md` section 7. No Laravel credential was reused and no real transaction was made.

### Awaiting historical data
* The legacy database (customers, orders, purchases, affiliates, commissions, comments, requests) is **not recovered**, and nothing in the platform was fabricated to stand in for it. Prices, authors and categories of recovered books are never inferred.
* The recovered media gave 127 evidence-based draft books, held only in the **isolated recovery stack** (not in Hosted), each with its source filename, hash, checks and an explicit list of what is uncertain. They appear in the admin review queue as drafts; none is published.
* Importing them into Hosted is a separate decision that needs your explicit authorisation.

### Awaiting trusted PDF delivery
* **All 445 PDFs flagged for `/Launch` remain quarantined and excluded.** No PDF check was weakened. The read-only review (`scripts/recovery/review-launch-pdfs.mjs`, `SUSPICIOUS_PDF_POLICY.md`) found: 439 whose every action only opens a sibling PDF, 6 with an action whose target could not be read, 0 naming an executable, script, URL or outside path, 0 with parameters. That is evidence for a decision, not clearance.
* A safe subset could only be admitted by a separate recorded process: your written decision, a sanitised derivative with a new hash that passes every existing check, a person's spot-check, a draft import into the recovery stack first.
* Other flagged PDFs (8 encrypted, 58 flagged only for ordinary links) were not part of the `/Launch` review and remain subject to the ordinary checks. A clean copy from the original publisher is the most reliable route for any of them.

### Blocked from public launch
1. No hosting project and no deployment exist (the Vercel account has one unrelated project). Protected preview first, public later.
2. Auth redirect URLs and custom SMTP are not configured, so confirmation and reset e-mails reach only your Supabase organisation members.
3. No administrator has been invited.
4. No payment method can be used (credentials and currency confirmation, above), so the store cannot sell.
5. The hosted catalogue is empty, and the historical customer and order data is not recovered.
6. The legacy VPS still carries unreviewed security indicators (`VPS_SECURITY_GATE.md`); nothing here runs on it.
7. Known gaps, not fixed (outside this release's scope): public pages are served from a shared cache for 1 to 5 minutes in an open (public) build, so unpublishing takes that long to show; affiliates, withdrawals and contributor requests are unpaginated lists (fine at the seed size, a scalability gap at volume); on Vercel the login-attempt limiter is per instance and static assets are served before the gate.
8. Opening the site publicly is a deliberate switch (`NUXT_PREVIEW_MODE=open`) and should follow the payments checklist.

## 3. What is needed to publish safely

1. **Decide** to merge: `git merge --ff-only vps-recovery-prep` on `main`, then `git push origin main` (this publishes `ea3c183` and every branch commit). No force-push.
2. **Create the hosting project** (Vercel: repository root, Nuxt, Node 22, `npm ci`, `npx nuxt build`; do not set `NUXT_PREVIEW_MODE`) and enter the environment from `PROTECTED_PREVIEW_DEPLOYMENT.md` section 3 in its dashboard: the hosted project URL, publishable and secret keys, the site URL, `NUXT_PREVIEW_USER` and a password hash made with `scripts/preview/hash-password.mjs`. Keep `NUXT_PAYMENTS_ENABLED_PROVIDERS` empty. Never paste secrets into chat or commit them.
3. **Configure Auth and SMTP**, then invite the administrator and enrol the authenticator.
4. **Deploy, then verify from outside**: `scripts/preview/verify-preview.mjs` and the `preview-production` spec with `PREVIEW_ORIGIN`, `PREVIEW_USER`, `PREVIEW_PASSWORD`. Share the link only when both pass. Share the password through a different channel.
5. **Decide on the drafts**: authorise importing the 127 evidence drafts into Hosted (or not), then review each in the admin before anything is published.
6. **Payments**, when you want them: open sandbox accounts, confirm the currency with each provider, set the variables from the checklist, test in sandbox, then follow the go-live checklist. Live stays off until you set it.
7. **Trusted PDFs**: obtain clean copies, or start the separate `/Launch` validation process, whichever you choose.

## 4. Local environment after the run

The development server and the local Supabase stack were stopped gracefully with their data volumes kept (no reset, no `--no-backup`, no volume deletion). The recovery stack was already stopped. Start them again with `npx supabase start` and `npm run dev`.
