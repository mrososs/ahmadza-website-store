# Incremental recovery and preview plan

Strategy (owner decision, 2026-11-06): recover and use as much **genuine** AAWRAQ content as possible, starting with `books`, `book_media`, `categories`, `makers`, without waiting for a complete historical recovery. Incomplete books stay **drafts** with an explicit missing-media status. Nothing is invented. The legacy VPS stays **unchanged**; paid downloads and live payments stay **off** until their own gates pass.

## 1. What is known and what is not
| Fact | Source / state |
|---|---|
| The VPS inspection has **not** been run yet; no dump, no datadir copy and no inspection output exist on this PC (`D:\mostqel\vps-inspection\` and `…\aawraq-quarantine\db\` are empty) | checked 2026-11-06 |
| Physical MariaDB files exist and there are two Hostinger backups | reported by the owner; dates, sizes, MariaDB version, whether the files are intact and whether the backups can be restored anywhere **other than over the production VPS** are **unverified** |
| MariaDB was previously reported stuck/unhealthy | earlier audit; current state unknown until the inspection runs |
| The 1,060 recovered product files (1,039 unique blobs) have no database to map them to | `LOCAL_DATA_PROVENANCE.md` |

## 2. The safest path — ranked, all without changing the production server
**Rule zero: never restore a Hostinger backup over the production VPS.** An in-place restore replaces the current disk state (including the evidence of the earlier incident) and cannot be undone from our side. A backup is only usable if it can be restored to a **new, isolated** machine or downloaded.

| # | Path | Use when (read from the inspection: `classify-inspection.mjs`) | Touches production? |
|---|---|---|---|
| **A** | Copy an **existing dump/backup archive** (`*.sql(.gz)`, a Laravel-backup zip with `db-dumps/`, a CyberPanel backup) | the report lists candidates | read-only copy |
| **B1** | **Table-limited dump from the live server**: `mariadb-dump --single-transaction --skip-lock-tables` of the catalogue tables only | MariaDB is alive and answers `mysqladmin ping` | read-only queries (adds a little load; no restart, no change). Uses the site's own credentials on the server — never shared |
| **B2** | **Read-only copy of the physical files** (datadir) → recovered on this PC with `recover-from-datadir.ps1` | MariaDB is **not running**, the AAWRAQ table files and `ibdata1` are present, no encryption | read-only copy; the copy-of-the-copy is what gets started |
| **B3** | A **Hostinger backup restored to a NEW isolated VPS** (or downloaded) → then B1/B2 there | only if hPanel/support confirms a restore target other than the production VPS | none — but verify the claim first (§4) |
| **C** | Escalate to Hostinger for the oldest provider backup and its restore/export options | nothing above is possible | none |
| **STOP** | Encryption settings found in `/etc/my.cnf*` | encrypted tablespaces cannot be read elsewhere without the server's key files | — |

## 3. B2 in detail (the most likely path) — exactly what you copy
**Preconditions** (the inspection report shows them): `FLAG mariadb_active` is not `active`, no `mariadbd/mysqld` process in the health block, `FLAG encryption_hint=no`, `FLAG books_table_file` is not `none`, `FLAG mariadb_version` is recorded. If MariaDB **is** running, prefer B1; copying live InnoDB files can be inconsistent (the recovery tool will still replay the redo log, but treat the result as best-effort).

**Copy with WinSCP (root, download direction only) from the data directory** (`FLAG datadir`, normally `/var/lib/mysql`) into a **flat** folder `D:\mostqel\aawraq-quarantine\mysql-copy\` that mirrors the datadir layout:
| Copy | Why |
|---|---|
| `ibdata1`, `ib_logfile0` (and `ib_logfile1` if present), `undo001`… `undo003` (if present) | InnoDB system tablespace, redo and undo logs — **must be copied together with the table files** or the tables cannot be recovered |
| `aria_log.*`, `aria_log_control`, `ddl_recovery.log`, `mysql_upgrade_info` | server-layer logs MariaDB needs at start-up |
| the `mysql/` folder | system schema. **Sensitive:** it holds the hashed DB-account credentials of *every* site on the server. Keep it private in quarantine; never share, never commit |
| the **AAWRAQ database folder** (the name the report shows) | `.frm` + `.ibd` files of the application tables |
| **Do NOT copy** | other sites' database folders (out of scope), `ibtmp1`, `ib_buffer_pool`, binary logs, `*.err`, `*.pid`, `*.sock` |

**Prove production was not changed**: before and after the copy run `ls -la --time-style=long-iso <datadir>` in the Web Console and save both outputs; they must be identical. WinSCP's download only reads.

**Then (me):**
```powershell
powershell -NoProfile -File scripts/migration/recover-from-datadir.ps1 `
  -DataDirCopy D:\mostqel\aawraq-quarantine\mysql-copy -Database <aawraq database name> `
  -Image mariadb:<major.minor from the report> -EncryptionHint no
```
Use the **same MariaDB version family** as the server (the classifier prints `Recovery image to use`): MariaDB refuses to replay a crashed redo log from an older major version.

What the tool does (all tested on synthetic data, §7): hashes the pristine copy → starts MariaDB on a fresh copy of the copy with **no network** and `--skip-grant-tables` → crash recovery runs on that copy → if the server will not start it escalates `innodb_force_recovery` 1, 2, 3 and **stops at 3** → verifies every requested table with `CHECK TABLE` (a plain `COUNT(*)` can miss a damaged data page) → dumps the **catalogue tables only** (`books, book_media, categories, makers, related_books, site_infos, articles, pages`) table by table → **damaged tables are kept out of the core dump** and, at levels 1–3, salvaged into separate `salvage-*.sql.gz` files flagged *partial* → restores the dump into an isolated container and compares row counts and `CHECKSUM TABLE` → writes `recovery-report-*.json`. Customer/financial tables are **never** dumped without `-IncludeSensitive -OwnerAuthorised`; they stay safe in the untouched copy and can be extracted later with your written authorisation.

## 4. Hostinger backups (B3) — check and ask, restore nothing
In hPanel → VPS → Backups & Snapshots, write down for each of the two backups: type (automatic/manual), date and time, size, and which **actions** the UI offers (e.g. *Restore*, *Download*, *Restore to another VPS*). **Do not click Restore on the production VPS.** Then send support (or ask me to refine) this message:
> "Before restoring anything: can the backup dated <date> of VPS <id> be (a) restored to a **different, new** VPS, or (b) exported/downloaded? We do **not** authorise an in-place restore over the current VPS. If only in-place restore exists, please say so, and tell us whether the backup contains the MariaDB data directory and which MariaDB version."
Prefer the backup whose date is closest to **just before** MariaDB became unhealthy. We extract data from it only; nothing from a backup (PHP, scripts, uploads) is ever executed.

## 5. After a dump exists — incremental milestones
| # | Milestone | Acceptance | State |
|---|---|---|---|
| M1 | Extract catalogue tables from an isolated, consistent copy (A/B1/B2/B3) | verified dump + report; copy and VPS untouched | **tool built and tested**; blocked on the inspection / files |
| M2 | Restore dump into the throw-away MariaDB; importer **dry-run** | V1 counts + rejects reviewed with the owner | tools ready; blocked on M1 |
| M3 | Import into a **separate local Supabase stack** (not the current dev DB: it holds 113 synthetic books and 312 test users) | legacy ids and raw values preserved (`legacy_id`, `legacy_cost_raw`); incomplete books are `draft` | importer exists; **draft policy to implement** (§6) |
| M4 | Match books with the 1,060 recovered product files | every `book_media.file` ↔ `legacy_path`; report of linked / placeholder / external / orphan files; duplicates (31 groups) listed; nothing created from file names | linker exists; blocked on M3 |
| M5 | Covers and public images | the inspection's manifest + `compare-manifest.mjs` show what exists on the VPS; those folders (covers, category, maker, article, logo) are downloaded read-only through quarantine + antivirus + magic-byte checks and linked | tools ready; blocked on the inspection |
| M6 | Admin and storefront ready for a **partial** catalogue | admin shows per-book media status and a "needs media / needs price" filter; storefront lists only complete published books; honest empty/“being prepared” states | **not built yet** (§6) |
| M7 | **Protected** client preview | hosted-promotion tool with authorised-ref guard and rehearsal; preview host with access protection + `noindex`; Auth Site URL / redirect allow-list; paid downloads and checkout **off** | blocked on M3–M6, an approved import target, and a preview origin |
| M8 | Later, incrementally: customers, orders, financial history, remaining images | only with written authorisation; extracted from the same untouched copy; financial data and identifiers preserved verbatim | after the preview |

## 6. Rules for incomplete data (and the decisions I need from you)
1. **Never invent** a price, author, category, relation or date. Raw legacy values are kept next to the parsed ones (`legacy_cost_raw` etc.); legacy ids are preserved.
2. **Incomplete ⇒ draft.** A book is imported as `published` only if it is complete: valid price (or free) **and** at least one media row that is actually `available`. Otherwise it is imported as `draft` and its original legacy status must be recorded so it can be promoted later. *Today the importer sets the status from the legacy value before it knows about media; implementing the "complete-only" rule needs a small importer change plus a nullable `books.legacy_status_raw` column (a new migration, local first, then your approval for hosted).*
3. **Unparsable price on a paid book.** Today such a book is **rejected** (listed in `migration_rejects` with its full payload). For an incremental catalogue I propose importing it as a **draft** with price `0.00` and the raw cost preserved — the database already refuses to publish a paid book at 0, so it cannot be sold by accident. **Decision needed: reject (current) or draft-with-raw-cost (proposed).**
4. **Orphan files** (recovered PDFs no row points to) stay `UNMAPPED_MEDIA`; no product is created from a file name.
5. **Import target:** a separate local stack for the real data (decided at M3 with a fresh backup of the current local DB, which exists).

## 7. What has been verified (executed, synthetic data only — no real data exists yet)
| Check | Result |
|---|---|
| Inspection script on Linux (Ubuntu), tree mounted **read-only**, root | completes, no write attempted, masks credentials/emails/IPs (with and without `perl`), finds the planted dumps/archives/database folder/PHP file; new checks for MariaDB version, config and **encryption** work |
| Classifier on four simulated servers | A, B2, C and STOP ranked correctly; recommends the matching `mariadb:<major.minor>` image |
| `recover-from-datadir.ps1` — 29 self-test checks, **29 passed** (`scripts/migration/selftest-recover-from-datadir.ps1`, synthetic data) | **T1 crashed datadir** (SIGKILL): InnoDB crash recovery at level 0; all four catalogue tables clean; dump restored in an isolated container with identical row counts and `CHECKSUM TABLE`; the downloaded copy is byte-for-byte untouched; only catalogue rows dumped (the fake users/orders have structure only: no rows, no hash marker); raw price strings and file names preserved. **T2 refusals:** missing folder, no `ibdata1`, encryption hint, a copy with **two** application databases until one is named (no guessing), sensitive tables without authorisation, injection-shaped table names, unknown database — none creates a container. **T3 corruption** (clean-shutdown copy, data page overwritten): the damage is **detected** (not hidden), the table is kept **out of the core dump**, a flagged-partial salvage entry is written, the report lists it, and the three clean tables are still recovered and verified. **T4 realistic download** (another site's database folder deliberately left out): level 0 will not start, the ladder reaches level 1, all four tables are clean and verified, and nothing of the other site is in the dump |
| Classifier regression test (`tests/unit/vps-classify.test.ts`, 4 fixtures) | 5 / 5 |
| **Not yet verified** | the inspection on the real server; any real dump/datadir; behaviour on a very large datadir (hash/copy time, crash-recovery time); a real corrupted multi-page table (the synthetic one fit on a single page, so salvage found nothing to extract: the multi-page salvage path is untested); the Hostinger restore options; encrypted datadirs (refused by design, untested); a MariaDB version other than 10.6 |

## 8. What I need from you, in order
1. Run the inspection (`VPS_INSPECTION_STEPS.md`) — it now also records the MariaDB version, configuration and encryption hints — and put the output in `D:\mostqel\vps-inspection\`.
2. From hPanel: for each of the two backups, the date/size and the actions offered (§4). Do not restore anything.
3. Decisions: unparsable-price policy (§6.3), draft rule (§6.2), import target (§6.5).
