# AAWRAQ: feature-by-feature completion report

Written 2026-11-06 on branch `vps-recovery-prep` (nothing pushed, nothing deployed, hosted untouched). Direction followed: **the legacy database is no longer the critical path.** Everything below was built and tested without it.

Status key: **DONE** implemented and tested · **CREDENTIALS** implemented, awaiting real credentials · **DATA** implemented, awaiting real data · **NOT DONE** with the exact reason.

## Headline

| | |
|---|---|
| Automated tests | **531 of 531** vitest across 43 files, **130 of 130** browser tests (journeys at three widths, responsive, hydration guard, MFA, refinement; 3 affiliate-dashboard checks failed once because the dev server reloaded mid-run and passed on rerun); lint 0 problems; 4 typechecks 0 errors; production build OK; DB audit 0 unexpected; dev and recovery schemas identical |
| Real money | **Off.** Paymob and Tap are implemented but **not verified** against a real gateway (no authorised merchant credentials exist); live needs two explicit owner switches |
| Real catalogue | **0 fully recovered books.** 334 distinct genuine PDFs carry a clear title in their own metadata; 127 can become review drafts today. Nothing has been written to any database yet |
| Hosted Supabase | **Two migrations behind** (18 and 19), confirmed by a read-only dry run. Not applied: yours to run |
| Preview | Built and verified locally, **not deployed** (no hosting authorised) |

## 1. Real catalogue records recovered: DATA

The historical books, categories, makers, customers, orders and payments are **unrecoverable without the MariaDB database**; that is stated, not hidden. What the genuine files themselves establish (report: `migration-output/media-reconciliation.md`, git-ignored):

| Measure | Count |
|---|---:|
| Genuine books fully recovered (record and file linked by a legacy row) | **0** |
| PDF files / distinct blobs | 1,059 / 1,038 (18 duplicate groups, 21 redundant copies) |
| Blobs whose own PDF metadata gives a clear title (partially recovered) | **334** (345 files; 329 distinct titles; 331 with an author in the metadata) |
| ... of which staged and valid, importable as a draft **today** | **127** |
| ... awaiting staging | 207 |
| Blobs without a clear title | 201 |
| Encrypted PDFs (title not read) | 8 |
| PDFs flagged suspicious (active content recorded, never followed) | 503 (445 `/Launch` file links, 58 `/URI` links only) |
| Wrong magic bytes / unreadable / hash mismatch | 0 / 0 / 0 |
| Editor uploads | 203 files: 113 accepted (109 images, 4 videos), 90 rejected (incl. 1 php) |
| Recovered covers | **0** (the archive held none) |
| Verified book-to-file relationships | **0** |

Rules applied: a title is used only when the file's own metadata gives a clear one; a price, category, author (unless embedded in the file), original status or purchase history is never guessed; every such draft is `recovered_media`, price 0, with its evidence (checksum, size, PDF metadata) and **cannot be published** until the owner has reviewed and verified it, set a valid price and attached a validated file (enforced in the database).

Decision for you: 445 files are suspicious only because they contain `/Launch` actions that look like Word-style links to other files. They are kept out as specified. Tolerating PDF-target launches would make about 115 more titled files eligible. I did not change that.

**Next step (not run):** applying the 127 drafts needs the files staged in the isolated recovery stack itself (the importer never copies across stacks):
`node scripts/recovery/import-recovered-media.mjs --apply --target recovery` after staging into that stack. The dry run (`node scripts/recovery/import-recovered-media.mjs --dry-run`) is ready.

## 2. Genuine media reconciled: DONE (reconciliation) / DATA (relationships)

The reconciliation tooling and report are complete and tested (`scripts/recovery/reconcile-media.mjs`, `lib/pdf-evidence.mjs`; 24 + 18 + 9 + 4 tests plus policy tests). Relationships to books cannot be established without the database: 0 verified.

## 3. Storefront pages: DONE

Home, search (noindex), categories, authors, maker, articles and posts, static pages, book details, cart, checkout return, library, favourites, invoices, contact, auth pages, request-a-book, contributor pages, affiliate area. Canonical URLs on every public page (alternate slugs collapse to one address), sitemap and robots rules, covers fall back to the default when a file is missing, unavailable files say so. Original RTL Arabic design preserved.

## 4. Customer journeys: DONE (simulator and mocked gateways) / CREDENTIALS (real payment)

Browse, search, book page, register and login, cart, payment-method choice (offers only what the server says is available), pledge, hosted checkout redirect, server-side verification, order and entitlement, purchase history, library, secure download, failed, cancelled and pending payments. Free books have their own path: a server-validated claim that creates **no order, payment or invoice** (`claim_free_book`). Browser journeys at 1440, 768 and 390 cover guest, purchase success, purchase failure, no-payment-method state, account pages, admin, not-found and protected routes. They found and fixed 3 real bugs (a 404 link that did not leave the 404, the cart not being cleared after payment, and a lost backslash that would have blocked every admin with an authenticator at the code step).

## 5. Admin workflows: DONE

Books: create, edit, price, free/paid, categories and makers, cover upload, PDF references, publish and unpublish, soft delete and restore, clone. **Catalogue workflow status** computed by the database (draft, needs review, missing media, ready, published, archived) with a filter and badges. **Catalogue recovery** dashboard (what was imported, what blocks publication, rejects), audited verification and conservative promotion, per-book review with the evidence shown and a "reviewed" action, readiness reasons in Arabic. Store: customers, orders, **payments with a gateway status panel (names only, NOT VERIFIED badge, webhook URLs), a needs-review queue, and a re-check against Tap's API**, affiliates, commissions, withdrawals, contributor submissions, statistics. Site: settings, branding, pages, articles, contact and social details. Server-side authorization on every route, audit log, loading, empty and error states.

## 6. Paymob: CREDENTIALS

Implemented to the current official API (Intention API, Unified Checkout redirect, HMAC-SHA512 callback, redirect verification). Evidence is **mock-only**: the HMAC string is checked against the worked example in Paymob's docs; 31 contract tests; a real server against a mock gateway (25 end-to-end cases shared with Tap); 13 database tests (twenty simultaneous callbacks give one order). Not proven against Paymob itself. Open points that only a sandbox run can close are listed in `PAYMENTS_GO_LIVE_CHECKLIST.md` section 4 (notably: no public inquiry endpoint was found, so Paymob relies on the HMAC alone).

## 7. Tap: CREDENTIALS

Implemented to the current official API (hosted page charge, `hashstring` webhook signature, charge re-fetch before settlement, browser return re-fetch). 31 contract tests plus the end-to-end cases. Not proven against Tap itself. The exact text form of the amount inside the signature is undocumented, so three forms are accepted; the API re-fetch is the real authority.

Security properties proven for both (against mocks): prices come only from the database; a success redirect alone is never trusted; signatures are checked over the raw body in constant time; callbacks are bound to the **gateway-signed order id** (Paymob's HMAC does not cover our reference, which the legacy code relied on); a test key can never settle a live payment; webhooks are idempotent; no duplicate order, entitlement or commission under concurrency; a late or mismatching capture is flagged for the admin instead of being lost; stored payloads hold no card digits or customer data; gateway error text never reaches the browser.

## 8. Authentication and SMTP: DONE (MFA, confirmation, reset) / CREDENTIALS (SMTP, admin e-mail)

Done and tested: e-mail confirmation, password reset, session handling, profile management, admin invitation script (no default passwords, no invented e-mail), **administrator TOTP two-step verification**: enforced on the server for every `/api/admin` route (production default; API test with a real TOTP enrolment, browser test of the login step, enrol/verify/remove page), production environment validation that refuses to start a broken or unsafe production server. Needs you: custom SMTP (until then confirmation and reset mails reach only your Supabase team), the approved admin e-mail, the final public origin and redirect allow-list (`AUTH_PREVIEW_AND_SMTP.md`). Direct database reads by an admin through row-level policies are not gated by MFA (only the application's own API is); noted, accepted.

## 9. Secure media storage: DONE (independent parts) / CREDENTIALS (file service host)

Storage adapter with provider abstraction, metadata validation, secure authorised download (signed short-lived URLs, nothing public), missing-media handling, upload workflow, **download audit log** (who, which file, what happened; no IP, no path; verified through the real route), reconciliation. The private VPS file service is **not deployed**: the legacy host still has unreviewed security indicators (`VPS_SECURITY_GATE.md`), so nothing was installed or exposed there. What connecting it later needs is in `VPS_STORAGE_INTEGRATION_PLAN.md`.

## 10. Supabase migrations and security results: DONE locally, hosted pending

Migration 18 (partial-catalogue recovery) and **19** (payment binding and review flags, recovered-media provenance, workflow status, free claims, download audit). Local dev and the isolated recovery stack have identical schemas (12 fingerprint sections). The database audit caught a real mistake in my migration (default privileges let `anon` truncate the download log); fixed and the audit is back to 0 unexpected. Hosted: `supabase db push --remote --dry-run` shows exactly migrations 18 and 19 pending on the authorised project. Applying them is yours (the CLI refuses a remote write from an agent session).

## 11. Protected preview: DONE (built and verified) / NOT DEPLOYED

Fail-closed Basic-auth gate, noindex, non-cacheable responses forced on every path including errors, no checkout, webhooks or downloads, rate-limited login attempts, a post-deploy verification script (`scripts/preview/verify-preview.mjs`) tested against a protected server. Not deployed: no hosting access was authorised and publishing is your call. Exact configuration: `PROTECTED_PREVIEW_DEPLOYMENT.md`.

## 12. Git and deployment status

All work is committed locally on `vps-recovery-prep`; **nothing is pushed**, `main` is untouched (its one unpublished docs commit `ea3c183` was reviewed: two documentation files, no secrets, no personal data, no binaries). Branch history and the merge preparation are in `RELEASE_PREPARATION.md`. No deployment exists.

## 13. Exact steps before real purchases are enabled

1. Apply migrations 18 and 19 to hosted (your command, section 10).
2. Decide the **currency**: the store is USD; Paymob KSA integrations are normally SAR; the platform never converts (`PAYMENTS_GO_LIVE_CHECKLIST.md` section 5).
3. Obtain sandbox credentials from your own Paymob and Tap accounts; never reuse a key found in the legacy code.
4. Deploy a short-lived sandbox environment (public https origin, `NUXT_PAYMENTS_PUBLIC_BASE_URL`), run the sandbox checklist and record the answers to the open points.
5. Have at least one **validated book file** for every paid book you publish.
6. Set up SMTP and the admin account; enrol the admin's authenticator.
7. Set `NUXT_<PROVIDER>_VERIFIED=true`, then `NUXT_PAYMENTS_LIVE_ENABLED=true`, then switch the payment mode to live (all three are required), make one real purchase and refund it, and only then remove preview protection.

## What was not done, and why

| Item | Reason |
|---|---|
| Real Paymob and Tap end-to-end test | no authorised merchant credentials |
| Physical MariaDB recovery | no consistent copy exists; per your direction it is no longer pursued |
| Applying the 127 evidence drafts | needs staging into the isolated recovery stack first; not run |
| Deploying the preview | no hosting access authorised |
| Applying hosted migrations | the permission path forbids it from an agent session; command provided |
| Deploying the file service on the legacy VPS | unreviewed security indicators |
| Paymob transaction inquiry | no endpoint in the public documentation; nothing guessed |
