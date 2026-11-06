# VPS recovery runbook — MariaDB catalogue and book-to-PDF mapping

Goal: obtain a **restorable copy** of the legacy database, rebuild the real catalogue from it (never from file names), and map every legacy book to its recovered PDF — without changing, restarting or trusting the legacy server.
The agent has no access to the VPS. You run the read-only steps in the Hostinger Web Console / WinSCP and return **sanitised** outputs. Never send passwords, SSH keys, `.env` files, or the dump itself through chat.

## Ground rules (stop if any would be broken)
1. **No changes to production**: do not restart or repair MariaDB, CyberPanel, OpenLiteSpeed or the VPS; do not edit configs; do not delete archives, logs, database files or incident evidence.
2. **Never restore over the production database.** All restore/repair work happens on a copy (local container or an isolated clone).
3. **Nothing from the legacy server is executed.** Files are copied, hashed, scanned and magic-byte checked in quarantine first (existing pipeline).
4. **Nothing invented**: no products from timestamp-named files; unmatched rows become explicit "missing media" placeholders.
5. Customer/financial tables are imported only with your written authorisation (importer refuses otherwise).

## Step 0 — local safety net (DONE)
`D:\mostqel\backups\aawraq-local-pre-recovery-20261106-185805.dump` (+ `.sha256` `9e3679d0…18f3`): verified `pg_restore -l` readable, outside the repo. Local Docker stack untouched.

## Step 1 — read-only inspection on the VPS (you)
**Follow `VPS_INSPECTION_STEPS.md`** (exact copy-paste blocks: upload via WinSCP in Binary mode, verify the SHA-256 and line endings, run in the background with `nohup`, optional manifest, download to `D:\mostqel\vps-inspection\` — outside the repository, never pasted or committed). `NO_CONTENT_SCAN=1` skips the only two checks that read upload files, if you want zero chance of touching access times.
In hPanel → VPS → **Backups & Snapshots**: write down which snapshots/backups exist and their dates (do not restore anything).
Then the agent runs `node scripts/vps/classify-inspection.mjs D:\mostqel\vps-inspection\aawraq-inspect.txt`, which recommends A / B / C mechanically from the report (tested on simulated servers for all three outcomes) and lists the dump candidates, the media folders (covers!) and the blocking findings for the file-service gate.

## Step 2 — decide the database path from the inspection output (section 4)
| What section 4 shows | Path |
|---|---|
| A dump or backup archive exists (`*.sql`, `*.sql.gz`, a `backup*` zip, a Laravel-backup zip containing `db-dumps/*.sql`, a CyberPanel backup) | **A — copy it** |
| No dump, but the MariaDB data directory has the AAWRAQ database folder with `.ibd`/`.frm` files and `ibdata1` | **B — clone and dump** |
| Neither | **C — escalate**: ask Hostinger support for the oldest provider backup/snapshot of the VPS and its restore options |

**A — copy it.** With WinSCP, copy the file to `D:\mostqel\aawraq-quarantine\db\` (outside the repo). Compute SHA-256 on both ends (`sha256sum` on the server, `Get-FileHash` locally) and confirm they match. If it is an archive with a password, you hold the password — tell me only that it is encrypted, never the password.
**B — clone and dump** (never on production):
1. hPanel → create a **snapshot** of the VPS first (a restore point), then restore that snapshot into a **new, isolated** VPS with no public site and a firewall that allows only your IP. (Or ask support to do the equivalent.)
2. On the clone, start MariaDB read-only against the copied data. If it will not start, use `innodb_force_recovery` starting at `1` and raising by one only if needed (values 1–3 are the safe read-only range; **do not exceed 3** without a specialist — higher values can lose data), then:
   `mariadb-dump --single-transaction --routines --triggers --default-character-set=utf8mb4 <aawraq_db> | gzip > aawraq.sql.gz`
3. Copy the dump off with WinSCP, verify SHA-256, then **destroy the clone** once the dump is verified.
**C — escalate**: no further step until a restorable source exists. The catalogue cannot be imported without it.

## Step 3 — restore locally into a throw-away MariaDB (me, after the dump is in quarantine)
One script does it, with guards (tested end to end on a synthetic dump; it has never seen real data):
```powershell
powershell -NoProfile -File scripts/migration/restore-legacy-db.ps1 -Dump D:\mostqel\aawraq-quarantine\db\aawraq.sql.gz
npm i -D mysql2
# when the import work is finished:  powershell -NoProfile -File scripts/migration/restore-legacy-db.ps1 -Remove
```
What it enforces: only `.sql` / `.sql.gz` whose first bytes look like a dump (a PHP/HTML/executable disguised as a dump is refused); free space on the work drive ≥ 4× the dump; never overwrites an existing container or a non-empty data directory; the container binds to `127.0.0.1` only (verified after start); data lives on D: (`D:\mostqel\aawraq-legacy-restore`, not Docker's small C: volume); random passwords written to `credentials.txt` there (outside the repo, never printed); utf8mb4; import by `docker cp` + in-container read (no PowerShell re-encoding of Arabic); a **SELECT-only** account `importer_ro` created and proven (a write attempt must fail); exact row counts per table printed. The first start on a Windows bind mount takes minutes (the script waits up to 10 minutes and says so).

## Step 4 — profile, then dry-run (no writes)
Real record counts per table (books, book_media, categories, makers, users, orders, payments, withdraws, request_books), charset/timezone, orphan rates, and the open mapping decisions in `docs/legacy-audit/16`. Then:
```powershell
$env:LEGACY_DB_HOST='127.0.0.1'; $env:LEGACY_DB_PORT='33306'; $env:LEGACY_DB_NAME='aawraq'; $env:LEGACY_DB_USER='importer_ro'; $env:LEGACY_DB_PASSWORD='<throwaway>'
node scripts/migration/import-legacy.mjs --dump <file> --dry-run
```
The report must show legacy-vs-planned counts (V1) and the rejects list; you review it with me before any write. Timestamps are read as UTC until the Laravel timezone is confirmed.

## Step 5 — catalogue into LOCAL Supabase, then book-to-PDF mapping
**Target choice first** (see `LOCAL_DATA_PROVENANCE.md`): the current local database holds 113 synthetic books and 312 test users and must not be mixed with real records. Import into a **separate** local Supabase stack (own project id and ports) or a freshly reset database after a fresh backup — decided with you at this step, not before. Nothing local is ever promoted to hosted.
1. `import-legacy.mjs` (no `--sensitive`): settings, categories, makers, books, book_media, related_books, articles, pages. Idempotent; records `migration_runs`, `migration_rejects`, `legacy_id_map`.
2. **Mapping rule** (existing, tested): `book_media.file` (e.g. `product_media/<site>-<time>.pdf`) → `legacy_path = storage/app/public/<file>` → matched to the staged object by that path (SHA-256 object key); `is_free` 0/2 → `preview`, 1 → `after_purchase`; `external = 1` + https URL → external link; otherwise a **placeholder row** with `migration_status = 'missing'`.
3. Reconcile (`npm run migrate:reconcile`): books imported vs legacy, media rows linked / placeholder / external, **orphan files** (recovered PDFs no row points to — listed in `UNMAPPED_MEDIA`, never turned into products), duplicate groups (recovered: 1,060 files, 1,039 unique blobs), rejected files (never imported). Success criteria: every legacy book accounted for; every unmapped item listed with a reason.
4. Covers and other images: run `node scripts/vps/compare-manifest.mjs /tmp/aawraq-manifest.tsv` on the manifest from Step 1 to see what exists on the VPS but was not in the recovered archive (covers, category/maker/article images, logos). Those files go through the same quarantine + antivirus + magic-byte pipeline (`migrate:inventory`, `migrate:scan`, `migrate:stage`) before linking.
5. Customer/financial phases only with your written authorisation, rehearsed first on a disposable database (orders are append-only), then V8/V9 reconciliation.

## Step 6 — promotion to hosted (NOT before sign-off; not yet built)
The importer and linker are deliberately **local-only**. Moving verified data to `ubjuyeccioflhpcpnhmo` needs a separate guarded tool (authorised-ref check, `--confirm-project`, dry-run, idempotent, re-runnable reconciliation) and a rehearsal first. It will be written and reviewed after Step 5 passes. PDF bytes go to the **private media service on a trusted host** (`VPS_SECURITY_GATE.md`), never to Supabase Storage.

## What I need back from you, in order
1. Sanitised `aawraq-inspect.txt` (+ the manifest file if you generated it) and the hPanel snapshot/backup list.
2. Which path (A/B/C) applies; for A or B: file name, size, SHA-256 (not the file) and where it sits in quarantine.
3. Written answers to the open decisions in `docs/legacy-audit/16` that block the import (test-order policy, soft-deleted users, PII/retention, related-books meaning, commission/freeze/minimum).

## Stop conditions
Stop and ask if: the inspection shows an unknown account, key, process or listening port (compromise indicators); a checksum does not match; the dump is encrypted and the password is unavailable; the restore needs more than ~4× the dump size on a disk with less free space; any step would require changing the production server.
