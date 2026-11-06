# Safe acquisition plan for the real AAWRAQ database

Status: plan for owner approval. Nothing in it has been run on the VPS; this repository has no VPS access. Written 2026-11-06.

## 0. The situation, and the one rule that follows from it

The production MariaDB service is stuck in the **deactivating** state. A stop was requested and never finished. That means:

* the InnoDB files on disk are **mid-flight**: pages may be half flushed, the redo log may not be checkpointed, and a thread may still be writing;
* a copy of those files taken now is **not a backup**. It may open cleanly, open with silent damage, or not open.

**Rule: an inconsistent live datadir is never copied and treated as a valid backup.** The tools enforce this (section 6): a unit in `deactivating`, threads in uninterruptible I/O wait, or files that changed while sampled are classified `B2-UNSAFE`, never recommended.

Equally forbidden, whatever the temptation: restarting MariaDB, killing or signalling processes, changing permissions, restoring a Hostinger backup over the production server, bringing the shared `mysql` system tables up anywhere except a fully isolated recovery environment.

## 1. What Hostinger actually supports (researched; confirm in hPanel)

From Hostinger's own help pages (sources at the end):

| Fact | Consequence for us |
|---|---|
| Restoring a backup **or a snapshot** replaces **everything** on the VPS and is **irreversible**; the VPS is locked while it runs | An in-place restore destroys the current disk state, which is also the incident evidence. **Refused.** |
| Documentation describes restore **in place** only. A restore to a *different, new* VPS is **not documented** | Path B3 is unproven. It must be confirmed in writing by Hostinger support before it is counted on |
| Downloading a whole VPS backup or snapshot to your own computer is **not supported**; only individual files over SFTP | We cannot simply download the 29 Oct or 6 Nov backup |
| Automatic weekly backups are kept in limited number (pages disagree between one and two weekly backups, and daily ones only if purchased) | The two weekly backups you see (29 Oct, 6 Nov) may be all that exists, and may rotate out. Do not wait indefinitely |
| **Only one snapshot exists at a time. Creating a new snapshot overwrites the previous one.** Snapshots are deleted automatically after 20 days; reinstalling the OS deletes them | **Do not create a snapshot** before checking whether one already exists: it would destroy it. A snapshot taken of a stuck server is crash-consistent at best |

Hostinger's pages do not say whether a backup contains a *consistent* MariaDB state. Weekly backups are typically taken from a running server, so they are crash-consistent: InnoDB can usually recover them with crash recovery, which is exactly what `recover-from-datadir.ps1` does on a copy.

## 2. Order of preference (safest first)

Every path below leaves production untouched. Use the first one that is genuinely available.

| # | Path | Condition | Status today |
|---|---|---|---|
| **A** | Existing dump or archive (`*.sql.gz`, a Laravel backup with `db-dumps/`, a CyberPanel backup) | the minimal check or the full inspection lists one | unknown until the inspection runs |
| **B1** | Live **table-limited** dump (`mariadb-dump --single-transaction --skip-lock-tables`, catalogue tables only) | MariaDB answers `mysqladmin ping`. A deactivating server normally does not | unlikely; the ping tells |
| **B3** | A **Hostinger backup restored to a NEW, isolated VPS**, then recover from that VPS's datadir (it is a restored, quiescent copy) | Hostinger support confirms in writing that a backup can be restored to a different VPS | **unproven. Ask now** (section 3) |
| **B2** | Read-only copy of the datadir, recovered on this PC | MariaDB **cleanly stopped**, no process, files **not changing** (`datadir_consistent_copy_source=true`) | **not available while the unit is deactivating** |
| **C** | Escalate to Hostinger for a consistent provider copy | nothing above works | the fallback |
| **STOP** | encryption settings found | encrypted tablespaces need the key files | check with the minimal script |

B2 becomes available only if the *owner or Hostinger* brings MariaDB to a clean stop. Doing that is a production change; it is your decision to make, not part of this tooling, and it is not requested here.

## 3. Ask Hostinger support, in this order, in writing

Send this before anything else; the answer decides between B3 and C. Keep the reply.

> We have a VPS (id `<id>`) whose MariaDB service is stuck in the *deactivating* state. We need a **consistent copy of the database files without changing this server**. We do **not** authorise an in-place restore of any backup or snapshot over this VPS.
> 1. Can the weekly backup dated 29 October (and the one dated 6 November) be **restored to a different, new VPS**? If yes, how, and does it keep the original untouched?
> 2. If not, can you attach or export a **copy of the backup** (disk image or archive) to us?
> 3. Is there already a **snapshot** on this VPS? (Please do not create one: creating a snapshot overwrites an existing one.)
> 4. Were these backups taken while the server was running? Is the MariaDB data directory included?
> 5. Can you see why the service is stuck in *deactivating* (stuck I/O, a full disk, a hung stop)?

Do not click Restore in hPanel. Do not create a snapshot until question 3 is answered.

## 4. Minimum read-only inspection (what to run, in this order)

Full detail and the exact diff against the version you reviewed: `VPS_INSPECT_SCRIPT_CHANGES.md`.

1. Upload `scripts/vps/minimal-mariadb-check.sh` with WinSCP (binary mode). On the server compare `sha256sum` with the value in `VPS_INSPECT_SCRIPT_CHANGES.md`.
2. Run it: `bash minimal-mariadb-check.sh > /tmp/aawraq-mariadb-check.txt 2>&1`. It takes about 15 seconds plus a few seconds to size the datadir. It answers, in one file:
   * **process state**: unit state and sub-state, threads in D state, whether `mysqladmin ping` answers;
   * **version and configuration**: exact `X.Y.Z`, `innodb_force_recovery` if set, the whitelisted InnoDB settings;
   * **data directory**: path, free space, system files, **redo layout** (classic `ib_logfile0` or the 10.8+ `#innodb_redo` directory), **undo layout**, and **whether the files changed during a 10-second sample**;
   * **backup candidates**: dumps and archives (name, size, date) and the storage layout that decides whether an LVM snapshot is possible on the server;
   * **encryption**: configuration only.
3. Review the output, then bring it to this PC. On this PC: `node scripts/vps/classify-inspection.mjs aawraq-mariadb-check.txt`.
4. Only if the minimal check shows no D-state threads, run the full `readonly-inspect.sh` (with `NO_CONTENT_SCAN=1` if you want zero file reads). It walks the whole filesystem; do not add that load to a server with stuck I/O.

## 5. Exact MariaDB version requirement

* **The copy must be recovered with the same MariaDB version that wrote it.** MariaDB refuses to replay a crashed redo log written by another major version, and a different series can misread structures silently.
* Nothing is assumed: not 10.6, not "latest". The exact `X.Y.Z` comes from `FLAG mariadb_version` of the minimal check (the output of `mariadbd --version`). If it is `unknown`, ask for it before recovering anything.
* `recover-from-datadir.ps1` **requires** `-SourceVersion X.Y.Z` and enforces:
  * the Docker image's own version (read **before** anything is copied) must equal it: a different major.minor is always refused, patch drift is refused unless you pass `-AllowPatchDifference`;
  * the datadir's own `mysql_upgrade_info` must agree on major.minor;
  * the running recovery server's `SELECT VERSION()` must be in the same series, and the exact version used is written into the recovery report.
* Pull the exact tag first: `docker pull mariadb:X.Y.Z`. Docker Hub keeps old patch releases; if the exact tag is missing, say so and we decide together.
* The classifier prints the image to use (`mariadb:X.Y.Z`) and the `-SourceVersion` value.
* Validated on this PC with synthetic crashed datadirs: 47 of 47 checks (version refusals, privacy, crash recovery, damaged-table handling, fidelity).

## 6. How the tools enforce the safety rules

| Condition | Enforced where |
|---|---|
| Never treat an inconsistent datadir as a backup | `classify-inspection.mjs`: `deactivating`/`activating`/`active`, a mariadbd process, D-state threads, or changing files => `B2-UNSAFE`, ranked last, never recommended. Tests in `vps-classify.test.ts` |
| No restart, kill, signal, permission change, write | `minimal-mariadb-check.sh` contains none; `vps-script-record.test.ts` fails if a forbidden command appears in either script |
| Never restore over production | Rule in this plan, the runbook and the classifier text; there is no tool that restores anywhere but a new isolated container |
| `mysql` system schema kept out | `recover-from-datadir.ps1` refuses `-Database mysql`, never dumps it, runs with **no network** (`--network none`) |
| Other sites' metadata and credentials out of logs | folder names and host-named files in the manifest are hashed aliases; server logs are printed only after redaction (accounts, hosts, IPs, db.table names, paths, secrets); raw logs only with `-KeepRawLog` into a private folder; only a **count** of other databases is reported |
| Exact version | section 5 |
| Validate recovered tables independently before import | `scripts/recovery/validate-recovered-catalog.mjs` (section 8) |

## 7. Files required for the isolated recovery

Only from a **consistent** source (A, B3, or B2 under its conditions). Copy with WinSCP, download direction only, into `D:\mostqel\aawraq-quarantine\mysql-copy\` mirroring the datadir:

| Copy | Why |
|---|---|
| `ibdata1` | InnoDB system tablespace |
| redo log: `ib_logfile0` (and `ib_logfile1` on MariaDB 10.4 and older) **or**, on 10.8 and newer, the whole `#innodb_redo` folder | needed for crash recovery. The minimal check prints which layout the server uses |
| `undo001`... (if separate files exist) | undo tablespaces; otherwise the undo log is inside `ibdata1` |
| `aria_log.*`, `aria_log_control`, `ddl_recovery.log`, `mysql_upgrade_info` | server-layer state needed at start-up; `mysql_upgrade_info` also feeds the version cross-check |
| the `mysql/` folder | required by the server to start. **Sensitive**: it holds every site's account and password hashes. Keep it in quarantine, never share or commit it, never dump it |
| the **AAWRAQ database folder** (the `.frm` and `.ibd` files, and `db.opt`) | the application tables |
| **do not copy** | other sites' database folders, `ibtmp1`, `ib_buffer_pool`, binary logs, `*.err`, `*.pid`, `*.sock` |

If the source is a **dump** (path A or B1), none of this is needed: restore it with `restore-legacy-db.ps1` and go straight to validation.

Work area on this PC (all outside the repository, git-ignored paths): quarantine for the copy, `D:\mostqel\aawraq-recovery` for the work copy and outputs. About 2.5 times the datadir size must be free (the script checks).

## 8. After a dump exists

1. `recover-from-datadir.ps1 -DataDirCopy ... -SourceVersion X.Y.Z -Database <ours>` (or `restore-legacy-db.ps1` for a dump). It produces a core dump of the catalogue tables only, verified by restore and `CHECKSUM TABLE`. Damaged tables are kept out of the core dump and salvaged separately, flagged partial.
2. **Independent validation before import:**
   ```
   node scripts/recovery/validate-recovered-catalog.mjs --inventory migration-output/inventory.json
   ```
   (environment `LEGACY_DB_*` pointing at the isolated restored copy, read-only account). It checks required tables and columns, primary keys, referential integrity (media to books, makers, categories, related books), price and status plausibility, media paths, character-set damage, dates, and how many media rows match a recovered file. It prints **counts and ids only**. Verdict `fail` stops the process.
3. `scripts/migration/import-legacy.mjs --target recovery` (dry run first). Real data goes only to the isolated recovery stack, never to the development database. Every recovered book is imported as a **draft** with its raw price and legacy id preserved.
4. In the admin area, `Catalogue recovery`: review the reconciliation, mark a run as verified genuine, then promote only the books that satisfy the whole publication rule (verified source, known original status, valid price, verified media relationship, at least one validated file). Anything else stays a draft with an explicit reason. Live paid checkout is a separate switch and stays off.

## Sources

* [How to back up or restore a Hostinger VPS](https://www.hostinger.com/support/1583232-how-to-back-up-or-restore-a-vps)
* [How can I back up or restore my VPS server (Hostinger support)](https://support.hostinger.com/vps/how-can-i-backup-or-restore-my-vps-server)
* [Hostinger backups: how they work and how to restore (HostAdvice, third party)](https://hostadvice.com/blog/web-hosting/hostinger-backups/)

These pages describe in-place restore, no download of whole backups, and one snapshot at a time. Whether a backup can be restored to a new VPS is **not stated** there; only Hostinger can confirm it.
