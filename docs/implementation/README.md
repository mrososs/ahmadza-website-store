# AAWRAQ platform — implementation guide

Nuxt 4 + TypeScript + Supabase (PostgreSQL, Auth, Storage), **local development only**. It rebuilds the legacy Laravel store (أوراق عربية) with the
original look (legacy CSS/markup ported 1:1), the verified business model, and fixes for the problems found in the legacy audit
(`docs/legacy-audit/`, `docs/legacy-ui/`, `ui-reference/` — all untouched).

## Status at a glance
| | |
|---|---|
| Implemented | public storefront, Supabase auth, cart + server-priced checkout (dev simulator only), entitlement-based private downloads, library/favourites/invoices/profile, affiliate programme with append-only ledger and withdrawals, contributor submissions with admin review, full admin area, media quarantine/staging pipeline, MariaDB importer (cannot run: no dump) |
| Verified | 221/221 tests, 0 type errors, 0 lint errors, production build, 45/45 UI validation runs (`09-testing-results.md`) |
| **Not possible yet** | importing real client data — **no SQL dump exists**; real payments — no gateway credentials (`10-remaining-blockers.md`) |

## Documents
`01-architecture` · `02-frontend-structure` · `03-supabase-schema` · `04-auth-and-permissions` · `05-legacy-ui-fidelity` · `06-business-rule-coverage` ·
`07-historical-data-import` · `08-security-decisions` · **hosted phase:** `HOSTED_SUPABASE_SETUP` · `MIGRATION_INVENTORY` · `RLS_PERMISSION_MATRIX` · `AUTH_INTEGRATION` · `HOSTED_INTEGRATION_TEST_RESULTS` · `VPS_STORAGE_INTEGRATION_PLAN` · · `09-testing-results` · `10-remaining-blockers` · `ui-validation/` · `data-availability-report.md` · `notes/` (per-slice detail).

## Local installation
Prerequisites: Node ≥ 22 (tested 24), npm, Docker Desktop (running; ≥ 8 GB RAM for Docker; ~15 GB disk for images), Google Chrome (UI tests).

```powershell
cd new-platform
npm install                      # also runs `nuxt prepare`
npm run assets:sync              # copies the licensed legacy assets that are NOT in this public repo (Janna LT fonts, Webmin admin.css)
                                 # from ../ui-reference (the recovered, verified reference). Without it the storefront falls back to system fonts
                                 # and the admin area is unstyled.
npx supabase start               # first run pulls ~3 GB of images; if a container is "unhealthy" with `exec format error`,
                                 # run `supabase stop`, `docker image rm -f <that image>` and start again.
                                 # Optional: `-x realtime,imgproxy,logflare,vector,edge-runtime,supavisor` saves RAM (not needed by the app)
npx supabase status -o env       # copy the local URL + publishable key + secret key into .env (see .env.example)
npx supabase db reset            # applies supabase/migrations/*.sql then supabase/seed.sql (DEV-ONLY demo catalog, is_demo = true)
npm run db:types                 # (optional) regenerate shared/types/database.types.ts
npm run dev:seed                 # local test identities + demo PDFs   (admin@ / customer@ / customer2@ / affiliate@ /
                                 #   contributor@ / banned@ aawraq.test — password in scripts/dev/seed-dev.mjs, local only)
npm run dev                      # http://localhost:3000   · Studio http://127.0.0.1:54323 · Mailpit http://127.0.0.1:54324
```

The legacy audit/UI documents, recovered archives and `ui-reference/` are **not** part of this repository (they live next to it in the private workspace). Everything refuses a non-local Supabase URL. Never run `supabase link` or remote pushes from this repository.

## Commands
| Purpose | Command |
|---|---|
| tests (needs `npm run dev` + seeded DB) | `npm test` · `npm run test:unit` · `npm run test:db` · `npm run test:api` |
| type check / lint | `npm run typecheck` · `npm run lint` |
| production build | `npm run build` (then `node --env-file=.env .output/server/index.mjs`) |
| UI validation | `node ../ui-reference/serve.mjs 4173` in another terminal, then `npm run ui:shots` → `docs/implementation/ui-validation/` |
| clean local state | `npm run db:reset && npm run dev:seed` (then `npm run migrate:stage -- --limit-bytes 400000000 --batch-id batch-1` to restage the bounded media batch) |
| remove demo data | `select public.purge_demo_data();` or admin → "بيانات تجريبية" |
| media / import pipeline | `npm run migrate:availability|inventory|scan|stage|import|reconcile` — see `07-historical-data-import.md` |

## Feature completion checklist
- [x] Nuxt runs locally; Supabase Local connected; migrations reproducible from scratch
- [x] RLS on every table, verified by the privilege matrix (anonymous/customer/unrelated/affiliate/admin)
- [x] Storefront: home, search/filters, categories, makers, book details, articles, CMS pages, contact, 404, sitemap
- [x] Auth: register/confirm/login/reset, server-side authorisation, roles from `user_roles`
- [x] Cart, server-side totals, checkout (**simulator only**), idempotent fulfilment + webhook replay safety, entitlements, signed-URL downloads
- [x] Library, favourites, invoices, profile
- [x] Affiliates: referral attribution, commissions, freeze, ledger, withdrawals, admin approval
- [x] Contributors: validated private uploads, admin review → draft book
- [x] Admin: books/media, categories, makers, articles, pages, users, orders, contacts, comments, settings, reports, demo-data
- [x] Legacy UI preserved (original CSS/markup); responsive RTL validated at 1440/768/390
- [x] Media inventory, quarantine, Defender scan, bounded private staging (272 objects ≈ 395 MB), `UNMAPPED_MEDIA` report
- [x] MariaDB importer built and unit/integration-tested on MOCK fixtures
- [ ] Real historical data imported — **blocked: no dump**
- [ ] Real payment gateway — **blocked: no credentials**
- [ ] Transactional mail, admin MFA enrolment UI, CSP, shared rate limiter (see 10)
