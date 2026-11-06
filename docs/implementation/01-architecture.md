# 01 — Architecture

One Nuxt 4 application (SSR storefront + account + affiliate + admin) on top of local Supabase (PostgreSQL, Auth, Storage).
No microservices, queues, search engine or separate admin app (decision D5 in `docs/legacy-audit/13`).

```
Browser ── SSR pages (public catalog, cache-safe) ─────────────┐
   │  ── client-only personalised UI (header state, cart, library, admin/affiliate SPA)
   ▼
Nuxt / Nitro  ──  server/api/**  (trusted: validation, authZ, pricing, signed URLs, webhooks)
   │                    │ user-scoped client (RLS)      │ service-role client (after explicit checks)
   ▼                    ▼                               ▼
Supabase Auth      PostgreSQL + RLS + SQL functions   Storage: public-media | private-products |
(cookie sessions)  fulfill_payment, ledger, …          private-sensitive | legacy-staging
```

## Versions (verified at build time, 2026-11-06)
Nuxt 4.6.4 (Nitro 2.13, Vite 8, Vue 3.5), `@nuxtjs/supabase` 2.1, Pinia 4.1 (`@pinia/nuxt` 1.0), Zod 4, Supabase CLI 3.0.0,
Vitest 5.1, Playwright 1.65, Node 24. `h3` is pinned to 1.15.x as a direct dependency (a transitive h3 v2 hoisted to the root broke the
Supabase SSR cookie adapter: `event.req.headers.get is not a function`).

## Boundaries
* **Reads** of public catalog data: browser/SSR → Supabase Data API under RLS (`shared/queries/catalog.ts`, explicit columns).
* **Writes** to anything financial, entitlement, role, upload or admin-managed: Nitro route → `requireUser/requireAffiliate/requireAdmin` → zod → service-role client or a trusted SQL function. The service-role key exists only in the server runtime (`NUXT_SUPABASE_SECRET_KEY`).
* **Money**: totals are computed in SQL (`create_payment_for_cart`), orders/entitlements/commissions are created only by `fulfill_payment` (idempotent, row-locked).
* **Files**: paid PDFs live in a private bucket; the server checks entitlement then issues a signed URL with a short TTL.

## Rendering strategy (`nuxt.config.ts` `routeRules`)
| Routes | Mode |
|---|---|
| `/`, `/book/**`, `/post/**`, `/p/**` | SSR + SWR shared cache; logged-out markup only, personalised parts hydrate on the client |
| `/cart`, `/library`, `/favourites`, `/invoice*`, `/update-profile`, `/request-book`, `/user-book`, `/api/**` | `cache-control: private, no-store` |
| `/affiliate/**`, `/admin/**` | `ssr: false` |

## State management
Server data → `useAsyncData`; search/filter/page → URL query; cart → Pinia (ids only, `localStorage`); auth → Supabase session; no
Supabase rows are mirrored into global stores.

## Local-only environment
`supabase/config.toml` (project `aawraq-local`, `auto_expose_new_tables=false` so every grant is explicit), `.env` (git-ignored, local keys),
`.env.example` (names only). Nothing in this repository connects to a hosted Supabase project or the legacy VPS.
