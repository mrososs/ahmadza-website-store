# Legacy articles recovery and the secure PDF.js reader

Status 2026-11-08. Nothing here opens the public storefront, activates a payment method or touches the personal website.

## 1. Legacy articles: what exists, what was recovered

**Where the originals live.** Legacy articles are rows of the `articles` table of the old MariaDB (fields `article_type` article|video|ads, `pref` = excerpt, `content` HTML, `status`, `show_public`, soft deletes, poster file). There is **no local dump, backup or isolated copy of that table** (searched: source extract, `legacy-staging`, the recovery stack, the 203 editor uploads, exports). The 203 editor uploads are images only and are not evidence of any article. The database cannot be read here (it must never be restarted or have its data directory copied).

**What could be recovered, and how.** The Internet Archive holds genuine captures of the public site. They are **secondary evidence**: the page as rendered at one moment, not the database row. Every capture was downloaded as raw bytes (`id_` form), validated (rejects the hosting placeholder page and anything without an article body), stored outside the repository and parsed as text only.

| Item | Count |
|---|---|
| Archived URLs matching an article pattern (`/post`, `/article`, `/articles`) | 61 distinct captured versions |
| Downloaded as genuine pages | 59 (2 are 404 in the archive) |
| Article pages with a body | 39 versions |
| **Distinct articles with a recovered body** | **17** |
| Listing pages (titles only) | 11 |
| Distinct titles seen in archived listings and sidebars (upper bound, may include non-article items) | 73; 17 have a body, the rest are **title only and were not imported** |
| Imported to hosted `ubjuyeccioflhpcpnhmo` | 17, all `draft`, all `review_status = unreviewed` |
| Published | 0 |
| Inline images found in bodies | 7 references to the dead legacy host; **dropped from the body** (no broken images) and listed in each article's evidence |
| Poster images | none recovered (the poster URLs are encrypted tokens on the dead host) |

Per article the evidence (admin only, never public) records: capture timestamps and URLs, the SHA-256 of each downloaded file, text length, chosen capture, every legacy id/token seen (used for redirects), confidence (`high` = at least two captures and a substantial body, `medium` = one capture), and what is **missing**: author, category, publication date, publication status, poster. None of these was invented. The page counters ("3,508 … منذ سنتين") are kept as evidence text only; they are not stored as views or dates.

**Duplicates/versions.** 39 article-page versions collapse to 17 articles by title; the longest, newest capture is the one stored, older ones stay in the evidence. The import key is a SHA-256 of title plus text, so a second run inserts nothing (verified: 17 inserted, then 0 inserted / 17 already present).

**Sanitising.** The body goes through the same allow-list as the admin editor (no script, event attributes, `javascript:` URLs, iframes, embeds, forms); verified on the stored rows (no `<script`, `javascript:` or `onerror=`).

**Unknown publication status = draft.** The page being captured does not prove the article was published at the time of the archive or is wanted now.

## 2. Schema (additive only)

`20261119000000_articles_recovery_provenance.sql` (applied to hosted): `original_slug`, `legacy_refs text[]`, `content_sha256` (unique when present), `source_system`, `source_evidence jsonb`, `review_status`, and `resolve_legacy_article(text)` (returns an id only for a published article). The provenance columns are **not** in the public column grant (checked on hosted: anon/authenticated cannot read them).

`20261119000100_articles_date_provenance.sql` (**not yet applied**, see section 6): `date_is_original` so the storefront never shows the import time as a publication date. The storefront already tolerates its absence (it then shows no date).

## 3. Storefront and admin

* `/articles` lists published articles only (search, order, pagination already existed). `/post/<id>`; any other value (a legacy numeric id such as `/post/598943/slug`, a Hashids token such as `/post/64ae26/…`, or a legacy `/article/<token>`) is resolved through `resolve_legacy_article` and answered with a **301** to `/post/<new id>`; unknown or unpublished refs are 404. Canonical, title and description come from the article; no poster block when there is no poster; no date when the date is unknown.
* Admin (`/admin/articles/<id>`): a notice shows the evidence (source, confidence, captures, what is missing); the editor and poster upload already exist. Saving with status "مفعلة" is the explicit approval: it sets `review_status = approved` and publishes (audited). Unpublish by choosing "غير مفعلة".

## 4. The reader

| Piece | Where |
|---|---|
| PDF.js canvas renderer (one page at a time, cancels the previous render, destroys the document and canvas on unmount, refits on resize) | `app/composables/usePdfReader.ts` |
| Reusable component (RTL, toolbar, page indicator and jump, zoom, fit-to-width, fullscreen, keyboard, remembered page, retry, purchase and pending states) | `app/components/books/BookPdfReader.vue`, page `/read/<book id>` |
| Self-hosted decoder assets (CMaps, standard fonts, WASM), no CDN | `scripts/copy-pdfjs-assets.mjs` → `public/_pdfjs/<version>/` (generated on `postinstall`, not committed) |
| Server authority | `GET /api/reader/:bookId` using `shared/utils/readerAccess.ts` |
| Admin | `AdminReaderPanel` + `GET /api/admin/books/:id/reader-status` + publish guard |

The reader has **no** download, print, open-original or new-tab control and no iframe/object/embed; no storage location appears in the UI. This is a UX choice, **not** a claim that copying is technically impossible: a signed URL is necessarily visible to the browser's network tools for its lifetime (default 120 s), so an entitled reader can still save what their browser receives.

**Access rule** (`decideReaderAccess`): a book is free only when its explicit kind is `free` and it is published; a null/zero price is never free (the 334 recovered books have unknown prices and stay unclassified). Entitled owners and admins read paid books; everyone else gets 401/403 `purchase_required`. An outsider is never told whether a file exists; an allowed reader of a book without an available file gets the honest "قيد التجهيز" state. Every decision is written to `media_download_log` (reason prefixed `reader`). Responses are `Cache-Control: private, no-store`.

**Paid purchase flow.** The text `لقراءة الكتاب كاملًا، يرجى شراء الكتاب أولًا.` and the button `شراء الكتاب` (to the book page; no disabled payment method is shown). After a settled payment the existing entitlement is checked server-side on each reader session; nothing client-side (flags, local storage, a redirect back) grants access.

**Large PDFs.** Nuxt never proxies PDF bytes (Vercel limits request and response bodies to 4.5 MB). The server returns a short-lived signed delivery from the storage adapter (VPS media service: Range supported; Supabase: signed URL). `services/media-server` gained an exact-origin CORS allow-list (`MEDIA_ALLOWED_ORIGINS`), preflight for `Range`, and exposes `Content-Range`; without configuration there is no CORS. PDF.js streams the file and, with Range support, reads on demand. A session that expires mid-read ends in the retry state, which asks the server again from the same page.

**Paid first-page preview.** Public preview media (`visibility = preview`) is the only thing an outsider can receive. `assessReader` flags a public PDF that is the paid book itself (same hash, or as long) and the book update **refuses to publish** such a paid book (409). **Not done:** a dedicated low-resolution first-page preview artifact. The approved first-page *cover* images (307 attached, reviewed by an admin) are what a visitor sees today; an approved preview file can be attached through the existing media manager (`visibility = preview`), and nothing is attached automatically.

## 5. Acquiring the real articles table (read-only, non-destructive)

If the full table is wanted (all articles with authors, dates, status):

1. On the VPS, `bash scripts/vps/articles-acquire.sh` (sha256 `8c7dac8b16baa398a58910c7d8b728c3b12bcccc331a5732d052c852ebdb8183`). It refuses to start MariaDB, never reads the data directory, dumps the single table with `mysqldump --single-transaction`, writes a counts report and a manifest of article image files, and never prints credentials.
2. If MariaDB is not running (the script says so and exits 3): do **not** start it and do not copy its data directory. Ask Hostinger for a snapshot restored to a **new, separate** server, and run the script there.
3. Copy `articles.sql.gz` and the image files with WinSCP, then import into the **isolated local recovery stack** (never the live database), verify counts against the report, and re-run `scripts/recovery/recover-articles.mjs` with that source (it keeps the existing drafts by content hash).

## 6. What needs the owner

The authorisation system allowed the first migration but **denied the second** (it contains an `update` of the 17 rows). To apply it, in the Supabase SQL editor of project `ubjuyeccioflhpcpnhmo`, run the file `supabase/migrations/20261119000100_articles_date_provenance.sql`, then verify with `select count(*) from articles where date_is_original = false` (expect 17). Until then the storefront simply shows no date.

## 7. Verified

* Unit: 348 pass (new: reader access, reader readiness, media-server CORS).
* ESLint clean; the four type checks clean; production build succeeds.
* Browser, real Chrome, real recovered Arabic PDF (7 pages) served by the real media service with signed URLs and CORS: 24 of 24 checks (render, next/previous, jump, RTL arrows, zoom, fit, mobile refit, no iframe/download/links, no storage path in the DOM, no PDF request for a non-owner, exact purchase text and button, pending state, foreign origin refused, expired URL refused, remembered page). The three `/api/reader/*` answers were stubbed in that run; the server decision itself is covered by the unit tests only. **Not executed:** a database-backed run of the endpoint (the local Supabase stack was stopped for memory) and a live free-book read, because hosted has no PDF delivered yet.
