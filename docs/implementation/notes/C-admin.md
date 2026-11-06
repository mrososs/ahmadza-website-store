# Slice C — Administration

Status: implemented and verified locally (API tests + browser walkthrough of every page). Scope: the Webmin admin shell and all
catalog / content / customer / order / settings / report screens. Affiliate, withdrawal and contributor-request screens belong to slice D
(only linked from the sidebar here: `/admin/affiliates`, `/admin/withdraws`, `/admin/request-books`).

## What exists

| Area | Route (ssr:false, `middleware: ['admin']`) | API (`server/api/admin/**`, every handler starts with `requireAdmin`) |
|---|---|---|
| Login | `/admin/login` (layout `admin-blank`) — Supabase Auth, then `is_admin()`; non-admin is signed out with a clear message | — |
| Dashboard | `/admin` — real counts (+ "today"), live-only revenue, latest orders/books | `GET dashboard`, `GET badges`, `GET me` |
| Books | `/admin/books` (`?status=active|inactive|soon|trash`, search, pagination), `/admin/books/create`, `/admin/books/[id]` | `GET/POST books`, `GET/PUT/DELETE books/[id]`, `POST books/[id]/restore`, `POST books/[id]/clone`, `GET lookups` |
| Book media | `/admin/books/[id]/media` — upload PDF/audio (private bucket), https external links, order, preview / after-purchase, delete | `GET/POST books/[id]/media`, `PUT/DELETE books/[id]/media/[mediaId]` |
| Images | cover / category / maker photo / article poster (public bucket) | `POST images/[entity]/[id]` |
| Categories, makers, articles, pages | `/admin/<entity>`, `/admin/<entity>/create`, `/admin/<entity>/[id]` | generic `[entity]` routes (list, create, get, update, soft delete, restore) backed by `server/services/adminCrud.ts` |
| Users | `/admin/users` (status filter, e-mail search), `/admin/users/[id]` (profile, orders, library) | `GET users`, `GET/PATCH/DELETE users/[id]`, `POST users/[id]/restore` |
| Orders | `/admin/orders`, `/admin/invoice/[order_no]` — **read-only** | `GET orders`, `GET orders/[no]` |
| Contacts / comments | `/admin/contacts`, `/admin/comments` (`?status=`, `?book=`) | `GET/PATCH/DELETE contacts…`, `GET/PATCH/DELETE comments…` |
| Settings | `/admin/site-info` incl. branding uploads and the commercial parameters with a visible "pending owner confirmation" notice | `GET/PUT settings`, `POST settings/upload?field=` |
| Reports | `/admin/stats/{users,books,orders,revenue}` with date range, mode filter and CSV export | `GET stats/[kind]` |
| Own credentials | `/admin/edit-profile` — Supabase Auth `updateUser` with the user's own session (re-enter current password) | — |
| Demo data | `/admin/demo-data` — counts + purge behind the typed confirmation `DELETE-DEMO` | `GET/DELETE demo` |

Shared building blocks: `app/layouts/admin.vue`, `admin-blank.vue`; `app/components/admin/*` (AdminHeader, AdminSidebar with live badge counts,
AdminDataTable, AdminPagination, AdminFormField, AdminSelect (bootstrap-select look), AdminFileDrop (dropify look), AdminModal, AdminStatCard,
BookForm, BookMediaManager, AdminEntityList, AdminEntityForm); composables `useAdminApi.ts`; server utils `adminRoute.ts`, `adminUpload.ts`;
shared schemas `shared/schemas/admin.ts`; migration `20261109000000_admin_support.sql` (`admin_list_users`, grant on `purge_demo_data`).

## Security decisions
* **Authorization**: role from `public.user_roles` via `is_admin()` (never JWT metadata). 401 for guests, 403 for any non-admin (customer, affiliate). Reads use `adminRead`, mutations `adminWrite` (+ per-IP rate limit).
* **Writes** use the service role only after that check; every body/query is zod-validated; DB constraint errors map to 400.
* **Uploads** (`adminUpload.ts`): magic-byte sniffing (PDF, PNG, JPEG, WebP, MP3, M4A, OGG, WAV) — extension and client MIME ignored; hostile-marker scan (`<?php`, `<script`, `__HALT_COMPILER`, MVG `push graphic-context`, `AddType`/`AddHandler`, `auto_prepend_file`, `eval(` …) over the first 64 KiB and the tail; size caps (images 2 MiB, media 100 MiB = bucket limit, checked on `content-length` and on the real buffer); server-generated object names (`books/<id>/<uuid>.<ext>`); SHA-256 + byte size + MIME stored; paid media only in the private bucket.
* **Rich text** is sanitised on save (`sanitizeRichText`) for books, makers, articles, pages.
* **Deletes are soft** (`deleted_at`); no hard delete route exists for books/categories/makers/articles/pages/users. Orders and order items cannot be changed or deleted (DB trigger + no route).
* **Audit**: row triggers + an explicit `audit_log` row with `actor_id` for every mutation (`adminAudit`).
* CSV export neutralises spreadsheet formula injection; reports default to LIVE orders so test data never counts as revenue.

## Business-rule coverage (docs/legacy-audit/11)
| Rule | Decision | Implementation | Test |
|---|---|---|---|
| ADM-01 user list/filters | preserved | `users/index.get.ts`, `admin/users/index.vue` | admin.test "users…" |
| ADM-02 change user status | preserved (+ admin cannot change own status) | `users/[id].patch.ts` | admin.test "users…" |
| ADM-03 user details | preserved | `users/[id].get.ts`, `users/[id].vue` | authorisation matrix |
| ADM-04 dashboard | preserved with real queries; revenue = live paid only | `dashboard.get.ts` | authorisation matrix |
| ADM-05–08 reports | preserved (users, books, orders, revenue); legacy per-line fee columns exist only on imported history, not recomputed | `stats/[kind].get.ts` | "reports" |
| ADM-09 Excel export | changed to CSV (formula-safe) | same | "reports" |
| ADM-10 site settings | preserved; ranges validated (legacy accepted negatives / >100 %); commercial values flagged pending owner | `settings/*`, `site-info.vue` | "settings" |
| ADM-11 settings effect | public subset readable via column grants (migration 4) | — | RLS tests (lead) |
| ADM-12/13 backup UI | dropped here (infra: Supabase backups) — documented in remaining blockers | — | — |
| ADM-14 notify queue | dropped (dead code in legacy) | — | — |
| ADM-16 contact inbox | preserved (handled flag, delete) | `contacts/*` | "contacts and comments" |
| ADM-17 public affiliate-release GET | dropped (security) | — | — |
| ADM-18 admin affiliate management | slice D | — | — |
| CAT-01/02/03 price type, USD, status | preserved; status enum draft/published/coming_soon/archived; free ⇒ price 0 | `adminBookSchema`, DB check | "books CRUD" |
| CAT-06/08 categories, makers & roles | preserved (link tables) | `adminBooks.ts#syncRelations` | "books CRUD" |
| CAT-10 cover processing | changed: type/size validation, no server-side resize (documented) | `images/[entity]/[id].post.ts` | "cover upload" |
| CAT-11/12 media types, upload rules | preserved; visibility enum replaces `is_free` 0/1/2; legacy 100 MiB limit now enforced | `books/[id]/media/index.post.ts` | "accepts a real PDF…", "refuses hostile payloads" |
| CAT-13 PDF page counting | preserved (approximate regex count) | `countPdfPages` | "accepts a real PDF…" |
| CAT-14 external URLs | preserved, https only | `adminExternalMediaSchema` | "external media must be https" |
| CAT-18/19 soft delete / restore | preserved; legacy "mail every buyer all files" side effect **dropped** | `books/[id].delete.ts`, `restore.post.ts` | "creates a book…" |
| CAT-20 clone | preserved for metadata/relations as a DRAFT; media files are not copied (legacy collisions) | `cloneBook` | "creates a book…" |
| CAT-21 related books | preserved as data (semantics pending owner) | `book_relations` sync | "books CRUD" |
| CAT-25 comment moderation | preserved | `comments/*` | "contacts and comments" |
| CAT-32/33 articles, pages | preserved, sanitised, soft delete | generic entity routes | "rich text is sanitised" |
| CAT-34 public editor upload | dropped; admin-only upload route with allow-list | `images/…` | upload tests |
| CAT-39/40 unauthenticated mass-mail / state-changing GETs | dropped; all mutations are POST/PUT/PATCH/DELETE behind `adminWrite` | — | write-closed matrix |

## Tests
`tests/api/admin.test.ts` — 57 tests (authorisation matrix 401/403/200 for 19 read routes and 18 write routes; category lifecycle + audit; sanitisation; book CRUD/clone/media/uploads incl. 7 hostile payloads, oversize, wrong type; users/settings/orders/reports/demo/contacts/comments). Run: `npx vitest run tests/api/admin.test.ts` (needs the dev server on :3000 and local Supabase). Result at last run: **57 passed**. Browser walkthrough (Chrome DevTools MCP): login as admin and visit all 26 admin routes — each rendered its heading and data with no console errors.

## Deviations / honest gaps
* Rich text uses a plain `<textarea>` (HTML allowed, sanitised server-side), not Froala/tagify; the date-range picker is a native `<input type=date>`. Visual parity of those widgets was never a requirement (docs/legacy-ui/13).
* No admin "download" of private media (admins see metadata and sha256 only); a signed-URL admin preview is a possible follow-up.
* Admin MFA: `site_settings.require_admin_mfa` is honoured by `is_admin()` (needs an AAL2 session) and is toggleable, but **there is no TOTP enrolment UI** — enabling it without enrolling a factor locks admins out. Marked as a warning in the form.
* The rate limiter is in-memory per instance. Settings: `allow_test_payments` and `pending_owner_confirmation` are intentionally not editable.
* Legacy per-status counters beside each sidebar item are implemented for books/users and the totals of other groups; affiliates/withdrawals/request counts depend on slice D data (withdrawals/requests counts are wired).
* Tests leave soft-deleted rows (trash) behind; no cleanup (soft delete is the feature under test).
* Orders page: legacy had no standalone order list (orders lived under reports); `/admin/orders` is an addition required by the brief.
