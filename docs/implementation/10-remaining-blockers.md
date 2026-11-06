# 10 — Remaining blockers and next priorities

## 0. Blocking the hosted Supabase integration (owner action)
| # | Blocker | Action |
|---|---|---|
| 0.1 | ~~CLI on the wrong account / MCP write blocked~~ **Resolved 2026-11-06**: CLI authenticated with the owning account, linked to `ubjuyeccioflhpcpnhmo`; the owner ran `db push --remote` (15/15 applied, verified by CLI and MCP). Still open: the **secret key** must be pasted into `.env.hosted` by the owner | owner fills `NUXT_SUPABASE_SECRET_KEY` in `.env.hosted` (never in chat) |
| 0.2 | Hosted schema applied and fingerprint-compared (11 of 12 sections identical; `functions` differs only by `service_role` EXECUTE on 8 trigger functions = Supabase hosted default grants, harmless). **Not done:** hosted RLS suite (needs the secret key), Auth settings (`AUTH_INTEGRATION.md` §Hosted), first admin invitation, `rls_auto_enable()` hardening decision | `HOSTED_MIGRATION_RUNBOOK.md` §6, `AUTH_INTEGRATION.md`, `scripts/admin/bootstrap-admin.mjs` |
| 0.2b | ~~Migrations 16–17 pending~~ **Done 2026-11-06**: applied with `--remote`, 17/17, fingerprint identical (12/12 sections), `rls_auto_enable()` locked down (event trigger verified), `payout_methods` single SELECT policy | — |
| 0.2c | Auth: first admin invitation (needs the owner e-mail), SMTP, Site URL, redirect allow-list review, e-mail templates | table in `AUTH_INTEGRATION.md` "Settings that need YOUR input" |
| 0.3 | VPS storage: adapter + service built and tested locally; **not deployed**; the legacy VPS is NO-GO until inspected | `VPS_SECURITY_GATE.md`; owner runs `scripts/vps/readonly-inspect.sh` and returns the sanitised output |

## 0b. Defects found this phase (not hosted-specific)
| # | Defect | Note |
|---|---|---|
| D1 | Vue hydration mismatches in dev: `BookListing` on the empty hosted home page; `SiteHeader` on the seeded local home page ("Hydration children mismatch") | pre-existing; pages still render correctly after hydration; fix by making server/client render identical (auth-dependent header markup, `v-if` on async data) and re-check with `list_console_messages` |

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
