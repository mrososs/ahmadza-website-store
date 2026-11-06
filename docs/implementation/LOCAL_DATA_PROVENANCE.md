# Provenance of the data in the local Supabase stack (investigated 2026-11-06)

Question: are the 113 local books, the 312 local Auth users and the 1,263 staged media records real recovered legacy data, or development/test data? Method: read-only queries against the local database (`supabase_db_aawraq-local`), the dev seed (`supabase/seed.sql`, `scripts/dev/seed-dev.mjs`) and the test helpers. Nothing was changed.

## Verdict
| Data | Count | Real legacy data? | Origin |
|---|---:|---|---|
| Books | 113 | **No — 100 % synthetic** | 30 from the dev seed (`كتاب تجريبي رقم N`, `is_demo = true`) + 83 left behind by the automated test suites |
| Makers / categories | 19 / 16 | **No** | 9 + 6 from the seed (`مؤلف تجريبي`, `قسم تجريبي`), 10 + 10 created by admin tests (`مؤلف اختبار`, `قسم اختبار`) |
| Auth users | 312 | **No — 100 % test identities** | all on the reserved `aawraq.test` domain: 306 `t-<hex>@` accounts created by the test helper, 6 named dev identities (admin, customer, customer2, affiliate, contributor, banned) from `seed-dev.mjs` |
| `book_media` rows | 38 | **No** | demo PDFs / test fixtures; none has a legacy path, legacy id or checksum |
| Staged media (`legacy_media_staging`) | 1,263 | **Files: yes (recovered). Book relationships: none** | from the recovered archives; hashes were verified against the archive manifest (0 missing / 0 mismatched); **0 rows link to any book** |

## Evidence
**Books (113).** `legacy_id` is NULL on all 113; no book has `legacy_id ≥ 900000` (importer fixture range) either. All were created between 2026-11-05 and 2026-11-06 (development days). Title patterns: `كتاب تجريبي رقم #` ×30 (seed), `[test-d] …` ×63 (commerce test helper), `عنوان معدّل` ×10 and `نسخة من عنوان معدّل` ×10 (admin update/duplicate tests). **Zero** titles outside these patterns. Prices (5.00–20.00, 7.50, 9.50) and statuses are test fixtures; 63 are `archived` (test cleanup), 20 soft-deleted. The seed file states "Every row below is mock data flagged is_demo = true"; the 83 non-demo rows are test residue (the suites do not clean up after themselves).

**Makers, categories.** No `legacy_id` on any. Names are the seed/test patterns above.

**Users (312).** 312/312 on `aawraq.test` (a reserved test domain); 0 on any other domain; 0 profiles with `legacy_user_id`; 0 non-e-mail identities; 0 phone numbers on `auth.users`; created 2026-11-06 13:02 → 16:56 (a 4-hour window); 177 have signed in (the tests do). 9 profiles carry a phone value (none has a country) — verified: all nine are `t-<hex>@aawraq.test` test accounts. One admin role exists and belongs to `admin@aawraq.test` (verified). **No real person's data is present locally.**

**Staged media (1,263).** `legacy_path` values come from the recovered archive; product scope = 1,060 files (1,059 PDF + 1 MP3; 1,039 unique blobs; 271 staged into local storage, 789 inventoried only), editor-image scope = 203 (90 rejected by the safety rules and never staged). Product file names have the shape `أوراق عربية-<10-digit epoch>.pdf` (1,057), `copy_أوراق عربية-<epoch>.pdf` (2), `….mp3` (1). The embedded timestamps span **2022-10-19 → 2026-04-22 over 181 distinct upload days** — a useful hint for reconciling against `book_media`/`books` once the database exists, but **not** a relationship: no title, price, author or book id can be derived from a file name. `book_media_id` is NULL on all 1,263 rows.

## Consequences (policy)
1. **Nothing in the local database may be promoted to the hosted project.** It is development data; the hosted project stays empty until a verified import from an authentic dump (`VPS_RECOVERY_RUNBOOK.md`).
2. **No real accounts exist anywhere yet.** Real users will arrive only from the legacy dump, only with written owner authorisation (`--sensitive --owner-authorised`), created **without passwords**, `require_password_reset = true`, **no invitation e-mails** sent by the importer; PII fields (phone/country/region) only with `--include-pii`. The hosted Auth service currently has 0 users.
3. **Real data must not be mixed with test residue.** Import the real catalogue into a **separate** local stack (or a freshly reset database) rather than into this one: this stack holds 83 test books and 312 test users that look like catalogue rows. Restoring the legacy MariaDB dump (the throw-away container) is separate from the Supabase target; the choice of target is made at Step 5 of the runbook, with the pre-recovery backup (`D:\mostqel\backups\aawraq-local-pre-recovery-20261106-185805.dump`) as the safety net.
4. **Test hygiene (follow-up, not urgent):** the DB/API suites leave rows behind (83 books, 10 makers, 10 categories, ~306 users). They are harmless locally but are exactly why this database cannot serve as a staging target for real data.
5. **Book ↔ PDF relationships: 0 of 1,263 are verifiable today.** They become verifiable only when `book_media.file` from the real database is matched to `legacy_path` (`storage/app/public/` + `file`). Until then every product file stays `UNMAPPED_MEDIA`; no product is created from a file name.
