# 02 — Frontend structure

Nuxt 4 `app/` layout. Components use flat auto-import names (`components: [{ path: '~/components', pathPrefix: false }]`); folders only group by feature.

```
app/
├─ layouts/        default.vue (storefront shell), admin.vue + admin-blank.vue (Webmin), affiliate.vue
├─ middleware/     auth, guest, admin (UX redirects), affiliate-ref.global (?aff= → first-party cookie)
├─ plugins/        legacy-behaviour.client.ts (Bootstrap-4 data-API behaviour re-implemented, no jQuery)
├─ composables/    useShell, useSessionInfo, useMediaUrl, useCheckout, useFavourite, useAuthForms, useAdminApi, usePartnerApi
├─ stores/         cart.ts (Pinia: book ids only)
├─ components/
│  ├─ storefront/  SiteHeader, SiteFooter, SiteSidebar, SiteStatistics, CardTile
│  ├─ books/       BookCard, BookListing
│  ├─ cart/        CartModal
│  ├─ account/     LibraryBookCard, FileDrop
│  ├─ affiliate/   AffiliateHeader, AffiliateSidebar
│  ├─ admin/       AdminHeader, AdminSidebar, AdminDataTable, AdminEntityList/Form, AdminFormField, AdminSelect, AdminModal,
│  │               AdminPagination, AdminStatCard, AdminFileDrop, BookForm, BookMediaManager
│  └─ shared/      PageHeading, AppPagination, SelectPicker (bootstrap-select look-alike), ShareLinks
└─ pages/          see routes below
server/
├─ api/            68 handlers: public (contact, views, cart quote, checkout, webhooks, downloads), account/affiliate/contributor, admin/**
├─ services/       payments/ (provider interface, dev simulator, 501 gateway stubs), adminBooks, adminCrud
└─ utils/          supabase (requireUser/Affiliate/Admin, service/user clients), errors, rateLimit, sanitize, adminUpload …
shared/
├─ queries/        catalog, commerce, storefront (typed, read-only, run on any Supabase client under RLS)
├─ schemas/        zod schemas shared by forms and server routes
├─ constants/ utils/ (Arabic normalisation) types/ (database.types.ts is generated: `npm run db:types`)
```

## Routes

| Area | Routes |
|---|---|
| Public storefront | `/`, `/search`, `/categories`, `/authors`, `/maker/:id/:slug?`, `/book/:id/:slug?`, `/articles`, `/post/:id/:slug?`, `/p/:slug`, `/contact`, `/sitemap.xml`, `/robots.txt`; legacy `/product/:id`, `/article/:id` redirect |
| Auth | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/confirm` |
| Customer (middleware `auth`, client-fetched, never cached) | `/cart`, `/checkout/simulate/:reference` (dev only), `/checkout/return`, `/library`, `/favourites`, `/invoices`, `/invoice/:orderNo`, `/update-profile`, `/request-book`, `/user-book` |
| Affiliate (`ssr:false`) | `/affiliate-register`, `/affiliate`, `/affiliate/books`, `/affiliate/profit`, `/affiliate/withdraw`, `/affiliate/withdraw-settings` |
| Admin (`ssr:false`, server `requireAdmin`) | `/admin`, `/admin/login`, `books` (+create/:id/:id/media), `categories`, `makers`, `articles`, `pages`, `users` (+:id), `orders`, `invoice/:no`, `contacts`, `comments`, `site-info`, `stats/:kind`, `edit-profile`, `demo-data`, `affiliates` (+create/:id), `withdraws`, `request-books` (+:id) |

## Component reuse rules
Components exist only where the legacy markup repeats (book card, pagination, select picker, header/footer/sidebar, admin form/table/select/modal). Page-specific markup stays in the page. The legacy class names and DOM are preserved; the only added CSS is page-level `<style>` copied from the Blade `css` sections via `useHead`.

## UX states
Every data-driven page implements loading (spinner, identical on server and client to avoid hydration mismatches), error (with retry), empty and success states; forms show per-field zod messages.
