# 10 — Remaining blockers and next priorities

## A. Blocking real data (owner / external)
| # | Blocker | Impact | Action |
|---|---|---|---|
| 1 | **No MariaDB dump** (workspace and both archives re-verified; `data-availability-report.md`) | no catalog, prices, categories, customers, orders, payments, commissions or withdrawals can be imported; 1 060 product PDFs stay `UNMAPPED_MEDIA` | owner supplies a fresh dump; follow `07-historical-data-import.md` §6 |
| 2 | Covers, category/maker/article images, logo/posters, contributor documents not in the archive | pages use the legacy default cover; no poster/logo | owner supplies the other upload folders (or re-uploads through admin) |
| 3 | Legacy `.env` values: Hashids salt / `APP_KEY` | old public URLs/referral links cannot be decoded for 301 redirects | owner decision / supply the salt privately |
| 4 | Live commission %, freeze days, minimum withdrawal, gateway, currency/FX | modelled and configurable but **unconfirmed** (`site_settings.pending_owner_confirmation`); defaults 10 % / 30 d / 100 are the legacy migration defaults, not verified live values | owner confirmation (`docs/legacy-audit/16`) |
| 5 | Owner decisions: test-mode entitlements/commissions in history, soft-deleted users, contributor-document retention, payout-detail migration, English UI, related-books semantics, contributor settlement terms | blocks sensitive phases of the import | owner authorisation + decisions |
| 6 | VPS compromise indicators (hostile uploads, July–Sept 2026) | owner must rotate **all** legacy secrets and treat the VPS as compromised | owner action (not performed here) |

## B. Engineering items not done
| # | Item | Note |
|---|---|---|
| 1 | Real payment gateways (Paymob/Tap) | no authorised sandbox credentials; `server/services/payments/gateways.ts` has the verification design, adapters return 501. The development simulator is refused in production |
| 2 | Transactional e-mail / outbox (receipts, withdrawal decisions, submission receipts) | not built; auth mails work via GoTrue (Mailpit locally); production SMTP not configured |
| 3 | Admin MFA enrolment UI | `require_admin_mfa` is honoured by `is_admin()`, TOTP is enabled in config, but no enrolment screen — enabling the flag without enrolling locks admins out |
| 4 | Field-level encryption of IBAN / payout details | RLS-only today |
| 5 | Shared rate limiter | in-memory per instance; trusts `X-Forwarded-For` (must sit behind a trusted proxy); replace with a shared store before scaling out |
| 6 | Content-Security-Policy | preserved legacy markup uses inline styles/scripts; audit then add CSP |
| 7 | Docker data root is on C: (≈ 8 GB free after staging) | the remaining ≈ 6.2 GB of recovered media is **not** staged in local Storage; move Docker's data root to D: or stage only files referenced after the mapping exists |
| 8 | Importer customer/financial loaders never exercised on a populated target | rehearse on a disposable DB before any real run; `mysql2` to be added when the dump arrives |
| 9 | Hosted deployment, backups/PITR, observability, domain/CDN | explicitly out of scope (local only); roadmap `docs/legacy-audit/15` |
| 10 | Rich-text editor is a plain textarea; no admin signed-URL preview of private media; no refunds/revocation UI | acceptable for first release, listed for completeness |
| 11 | Real-site screenshots for visual sign-off | `docs/legacy-ui/14-ui-acceptance-checklist.md` unsigned |

## C. Next implementation priorities
1. Obtain the dump + uploads → run the import rehearsal (catalog first), link staged media, reconcile V1–V10, owner sign-off.
2. Owner confirms commercial parameters → update `site_settings`, clear `pending_owner_confirmation`.
3. Choose and integrate the payment gateway in sandbox (signature verification on raw body, amount re-verification, webhook replay tests already in place for the simulator path).
4. Transactional mail outbox; admin MFA enrolment; CSP; shared rate limiting.
5. Staging deployment on a **new** hosted Supabase project (separate decision, requires explicit authorisation), then migration rehearsals and cut-over per `docs/legacy-audit/15`.
