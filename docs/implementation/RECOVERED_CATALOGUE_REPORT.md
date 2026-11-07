# Recovered catalogue: what is in the hosted project, what the preview shows, what is still missing

Status 2026-11-07. Every number below was read from the database or from a tool report in this session, not estimated.

## 1. What was imported into hosted (`ubjuyeccioflhpcpnhmo`)

**334 genuine book drafts**, each one a recovered PDF whose own metadata gives a clear title. They are review-only records: `status draft`, never published, nothing purchasable.

| Hosted count | Before | After |
|---|---|---|
| books (all `recovered_media`, all draft, none demo) | 0 | **334** |
| book media rows | 0 | **334** (all `pending`, provider `none`: no file uploaded) |
| books published | 0 | **0** |
| demo books / test users / orders / payments | 0 | **0** |

Checked in the database itself after the import: 334 distinct SHA-256 values; 334 records carry the explicit "uncertain" block; 334 carry the original file name; all 334 pass the evidence checks (scan clean, hash verified, no active content, not encrypted); **0 prices, 0 author links, 0 category links, 0 covers**: nothing was inferred. The database computes the workflow of every record as `needs_review`.

How it was done (all idempotent, all re-runnable):
1. `scripts/migration/stage-media.mjs` staged the 207 titled PDFs that were not yet staged (127 were staged earlier) into the isolated recovery stack: 211 stored objects verified (size and hash), public and anonymous reads blocked.
2. `scripts/recovery/import-recovered-media.mjs --apply --target recovery` created their evidence drafts there (207 created, 0 failed).
3. `scripts/recovery/import-to-hosted.mjs --confirm ubjuyeccioflhpcpnhmo --apply` wrote them to hosted. Before writing, it re-hashed every quarantined PDF (334 of 334 matched), required the hash to be unique, required the evidence block, and refused any file in the `/Launch` set (0 overlap). A second run created nothing (idempotent). The media rows are `pending` with provider `none` because the database treats "provider + path" as an available file; the intended path is kept in the evidence (`hosted_import.intended_storage_path`).

## 2. File accounting (1,059 recovered PDFs, 1 audio file, 203 editor uploads)

| PDFs | Count |
|---|---|
| imported as drafts | **334** |
| suspicious, excluded | **503**: 445 with a `/Launch` action (439 only open a sibling PDF, 6 unresolved, 0 executables), 58 flagged only for ordinary links |
| encrypted, not imported | 8 |
| no usable title in the file (not imported: a file name is never evidence) | 203 |
| clear title but a duplicate copy of an imported file | 11 |
| **total** | **1,059** (334 + 503 + 8 + 203 + 11) |

Editor uploads: 203 files, **113 accepted** (101 PNG and 8 JPEG images, 4 videos), 90 rejected (hostile markers, active SVG, probes). **Covers recovered: 0**: the archives contain no cover images.

## 3. What the protected preview shows

`https://aawraq-store.vercel.app` (password required): a strip on the home page, a header link and the page `/recovered` ("الكتالوج المستعاد — قيد المراجعة") list the 334 drafts, 24 per page with search. Each card shows the recovered title, the "قيد المراجعة" badge (white on amber), "السعر غير محدد", "المؤلف غير محدد", the fallback cover and, on request, the evidence (original file name, page count and size from the file, a short fingerprint, the scan result). There is nothing to buy or download, and no link into a product page.

How it stays safe: the data comes from a narrow server query (service role, whitelisted fields only; `shared/utils/recoveredPreview.ts` decides what may leave) that answers only while the site is a protected preview and returns 404 when public. Row-level security and the publication rules are untouched. Verified as an anonymous visitor against hosted with the browser key: every column of `books` beyond the public grant, `recovery_evidence`, `provenance`, `book_media`, the readiness views, the staging table, the audit log, profiles, orders and payments answer `401 permission denied`; the one allowed query returns 0 draft rows.

## 4. Admin review (genuine data)

For a recovered book the review screen shows the original file name and path, page count, size, the scan at recovery, the import note, a plain-Arabic list of what was never established (price, author, categories, kind, publication status), the readiness reasons, and the linked files. Approve ("اعتماد"), **reject** (to the trash, restorable), edit of title, price, author and category, cover upload and the media manager are available. Publication stays blocked by the database until a valid price and a verified file exist. Checked in a real browser against the 127 genuine drafts of the recovery stack (read-only, no record changed). **Hosted has no administrator yet**, so this was not exercised on hosted itself: invite one (`PROTECTED_PREVIEW_DEPLOYMENT.md`, `AUTH_PREVIEW_AND_SMTP.md`).

## 5. Still missing, and why

* **PDF files are not in hosted.** The 334 PDFs total about 1.5 GB (182 MB + 1,383 MB) and sit hash-verified in quarantine and in the recovery stack. Until a verified upload to the private bucket, no book can be published or downloaded (media `pending`). Check the project's storage allowance first (a free Supabase project includes 1 GB). That upload is a separate, explicit decision.
* **Covers, category and author images, branding, blog images:** the five VPS folders are not in the workspace. `VPS_CONTENT_TRANSFER.md` has the exact download-only WinSCP steps. Even once copied, covers cannot be attached to books without the legacy database.
* **Legacy database (MariaDB):** not recovered; the service on the VPS was unhealthy and its data directory must not be copied as if it were a backup. So no genuine author, category, price, publication state, customer, order or payment exists, and none was invented. This did not block the import of independently verified content.
* **203 untitled PDFs** need a human to identify them; **503 suspicious PDFs** stay excluded (`SUSPICIOUS_PDF_POLICY.md`); 8 encrypted PDFs need a password or a clean copy.
