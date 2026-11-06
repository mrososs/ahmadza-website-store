# Supabase + Nuxt integration — completion report (2026-11-06)

Scope: the Nuxt application and the hosted Supabase project `ubjuyeccioflhpcpnhmo`. **Not production-ready** — real catalogue, payments and private PDF delivery are unverified (see §5).

## 1. Hosted Supabase
| Item | Status | Evidence |
|---|---|---|
| Migrations | ✅ 17/17 applied, 0 mismatched | `migration list --remote` and MCP `list_migrations` agree |
| Schema vs local | ✅ identical in all 12 fingerprint sections | enums 20 · columns 328 · constraints 131 · indexes 100 · RLS 31 · policies 45 · functions 31 · triggers 20 · table grants 56 · column grants 378 · buckets 4 · singleton 1 (`scripts/db/schema-fingerprint.sql`) |
| `rls_auto_enable()` | ✅ locked down | ACL = `postgres` + `service_role` only; `ensure_rls` event trigger still enabled **and fires** (probe table in a rolled-back transaction got RLS automatically) |
| `payout_methods` | ✅ one policy per command, one SELECT policy | policy list; hosted + local suites |
| `payment_events` | ✅ server-only | no policy, no table grant for API roles; denied to anon/customer/admin (tests) |
| Advisors | ✅ only reviewed items remain | security: INFO `payment_events` (intended) + 6 reviewed SECURITY DEFINER functions; performance: 14 INFO unused indexes (empty DB, keep) |
| Data on hosted | empty by design | 0 users, books, categories, makers, payments, orders, entitlements, storage objects; 10 synthetic audit rows (see `AUDIT_CLEANUP_PROPOSAL.md`) |
| Auth | ✅ checked, ⚠ needs your settings | sign-ups on, e-mail confirmation required, phone/social/anonymous off, foreign redirects refused. **Custom SMTP required**, Site URL still the Supabase default, allow-list unreadable from here (`AUTH_PREVIEW_AND_SMTP.md`) |
| First admin | ⏳ waiting for the approved e-mail | script + tests ready; no invitation sent, no default password anywhere |

## 2. Nuxt application
| Area | Status |
|---|---|
| Storefront (home, categories, search, authors, articles, pages, book page, cart) | ✅ DB-driven; honest empty states on the empty hosted catalogue; legacy layout preserved |
| Hydration | ✅ fixed at the cause (inline payloads): 39/40 → 0/40 warned under data change; 16-page Playwright guard + config unit test |
| Customer (register/login/profile/cart/orders/library/favourites/downloads) | ✅ local suite; hosted: boundaries, cart pricing, download matrix |
| Admin (dashboard, books, categories, makers, media, articles/pages, users, orders, **payments (new)**, settings, comments, contacts, affiliates, withdrawals, contributors) | ✅ 401/403/200 matrix on 10+ routes locally and on hosted; CRUD with audit on hosted |
| Affiliates & contributors | ✅ role boundaries and server-side rules tested; contributor **file uploads not exercised on hosted** (would put files in Supabase Storage — not allowed yet) |
| Payments | ⛔ not active: Paymob/Tap adapters are 501 stubs; simulator OFF on hosted (tested: checkout refused, no payment row created) |
| Media | ✅ VPS adapter + private media service built and tested locally (16 tests); **not deployed**; Supabase Storage not used for PDFs on hosted |

## 3. Test and build results (all executed)
| Gate | Result |
|---|---|
| Local vitest (unit + DB + API) | 278 / 278 |
| Hosted RLS + app integration (`npm run test:hosted`) | 39 / 39 (3 consecutive clean runs; one run hit a dev-server cold-start timeout, fixed by a warm-up, then 39/39 again) |
| Playwright hydration spec | 16 / 16 |
| Hosted Auth verification script | all checks ok |
| Security audit SQL (local) | 8 reviewed / 0 unexpected |
| ESLint · `vue-tsc` (4 projects) · production build | 0 errors · 0 errors · OK |

## 4. Repository
8 commits pushed to `mrososs/ahmadza-website-store` `main` (fast-forward `e80970e..00a1bf5`, no force). Reviewed before pushing: no env/key/archive files, no secrets in any added line, no hostname or incident specifics. Only `.env.example` and `.env.hosted.example` are published.

## 5. Remaining blockers before any public launch
| # | Blocker | Owner |
|---|---|---|
| 1 | No MariaDB dump → no real catalogue, prices, customers, orders; 1,060 PDFs unmapped to books | VPS recovery phase (`VPS_RECOVERY_RUNBOOK.md`) |
| 2 | Missing covers/branding/category/maker/article images | same (manifest comparison) |
| 3 | Secure PDF delivery deployed on a **trusted** host (legacy VPS is NO-GO until cleared) | VPS gate |
| 4 | Real payment gateway: sandbox credentials + merchant settings; webhook verification written against the provider's real spec | owner + engineering |
| 5 | Custom SMTP; Site URL/allow-list for the preview; first-admin e-mail; admin MFA enrolment screen | owner |
| 6 | Transactional e-mail, refunds/cancellations rules, contributor management page | engineering + owner decisions |
| 7 | Owner decisions listed in `docs/legacy-audit/16` (commission %, freeze days, minimum withdrawal, currency/FX, test-order policy, PII retention) | owner |
| 8 | Backups/PITR, monitoring, domain/CDN, protected preview deployment | later phase |

## 6. Local data preserved
Docker stack untouched (8 containers). Verified pre-recovery backup: `D:\mostqel\backups\aawraq-local-pre-recovery-20261106-185805.dump` (+ `.sha256`, outside the repo; database only — staged files stay in the Docker storage volume and in the verified quarantine copy under `D:\mostqel\aawraq-quarantine`).
