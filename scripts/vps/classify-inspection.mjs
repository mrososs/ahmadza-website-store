// Reads the SANITISED output of scripts/vps/readonly-inspect.sh and/or scripts/vps/minimal-mariadb-check.sh and ranks the database recovery paths from
// docs/implementation/INCREMENTAL_RECOVERY_PLAN.md, plus the media picture and the deployment gate signals. OFFLINE: it only reads that one text file.
//   node scripts/vps/classify-inspection.mjs D:\mostqel\vps-inspection\aawraq-inspect.txt [--json]
//
// Paths, safest first (none of them changes the production server):
//   A   an existing dump / backup archive is on the server        -> copy it (read-only)
//   B1  MariaDB is alive and answers                              -> table-limited --single-transaction dump of the catalogue tables
//   B2  MariaDB is cleanly STOPPED, files intact and not changing -> read-only copy of the datadir, recovered on this PC (recover-from-datadir.ps1)
//   B2-UNSAFE  the files exist but MariaDB is running / activating / DEACTIVATING, has threads in D state, or the files are still changing
//               -> NOT a consistent copy source. Never recommended, never a backup; listed only so nobody picks it by mistake.
//   B3  only a Hostinger backup has the data                      -> only if it can be restored to a NEW isolated VPS (never in place)
//   C   nothing usable                                            -> escalate to Hostinger
import { readFileSync } from 'node:fs'

// One or more report files: the full inspection and/or the minimal MariaDB check. Later files win where both print the same FLAG (the
// minimal check is the more specific and newer one), so:  classify-inspection.mjs full.txt minimal.txt [--json]
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!files.length) { console.error('usage: classify-inspection.mjs <aawraq-inspect.txt> [<aawraq-mariadb-check.txt>] [--json]'); process.exit(2) }
const file = files.join(' + ')
const text = files.map((f) => readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')).join('\n')

const flags = Object.fromEntries([...text.matchAll(/^FLAG ([a-z_0-9]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]))
const num = (k) => Number(flags[k] ?? NaN)
const section = (startRe, endRe) => { const s = text.search(startRe); if (s < 0) return ''; const rest = text.slice(s); const e = rest.slice(1).search(endRe); return e < 0 ? rest : rest.slice(0, e + 1) }
const lines = (block) => block.split('\n').slice(1).filter((l) => l.trim() && !l.startsWith('---') && !l.startsWith('==='))

// --- database sources ---------------------------------------------------------------------------------------------------------------
const dumpLines = lines(section(/^--- dump \/ backup candidates/m, /^--- (application|CyberPanel)/m)).filter((l) => /\.(sql|sql\.gz|sql\.bz2|sql\.zip|dump|bak)\b|backup/i.test(l))
const archiveLines = lines(section(/^--- application \/ site backup archives/m, /^--- Laravel \/ CyberPanel backup folders/m)).filter((l) => /bytes/.test(l))
const dbDirs = lines(section(/^--- ALL non-system databases/m, /^--- MariaDB error log tail|^--- MariaDB health/m))
const tableFiles = dbDirs.filter((l) => /table file/.test(l)).map((l) => l.trim())
const hasBooksTable = /table file\s+books\s+\d+ bytes/.test(text) && !/^none$/.test(flags.books_table_file ?? 'none')
const dumps = dumpLines.length || num('dump_candidates') || 0
const archives = archiveLines.length || num('backup_archives_over_5mb') || 0
const errBlock = section(/^\s*InnoDB \/ recovery \/ corruption lines/m, /^--- MariaDB version|^=== /m)
const innodbTrouble = lines(errBlock).filter((l) => /corrupt|crash|abort|no space|disk full/i.test(l)).length
const active = flags.mariadb_active ?? 'unknown'
const alive = active === 'active' && /alive/i.test(flags.mariadb_ping ?? '')
// any non-stopped unit state counts as running: 'deactivating' (a stop that never finished) is the dangerous one, its files are mid-flight
const UNSTABLE_STATES = ['active', 'activating', 'deactivating', 'reloading', 'refreshing']
const processState = flags.mariadb_process_state ?? 'unknown'
const dThreads = Number(flags.mariadb_threads_in_d_state ?? 0) || 0
const changing = flags.datadir_changing === 'yes'
const unstableWhy = [
  UNSTABLE_STATES.includes(active) && `the MariaDB unit is '${active}'`,
  /^running/.test(processState) && 'a mariadbd/mysqld process is running',
  dThreads > 0 && `${dThreads} thread(s) are stuck in uninterruptible I/O wait (D state)`,
  changing && 'the datadir files changed while they were being sampled',
].filter(Boolean)
const running = UNSTABLE_STATES.includes(active) || /^running/.test(processState) || /(^|\s)(mysqld|mariadbd)\s*$/m.test(section(/^--- MariaDB health WITHOUT restarting/m, /^\s*df |^--- ALL non-system|^InnoDB/m))
const encrypted = flags.encryption_hint === 'yes'
const sysFiles = num('ib_system_files')
const physicalOk = hasBooksTable && sysFiles >= 1 && !encrypted
const version = flags.mariadb_version ?? 'unknown'
const mm = version.match(/^([0-9]+[.][0-9]+)/)
const full = version.match(/^([0-9]+[.][0-9]+[.][0-9]+)/)
const recommendedImage = full ? `mariadb:${full[1]}` : mm ? `mariadb:${mm[1]} (series only: the exact X.Y.Z patch was not captured; recover-from-datadir.ps1 needs it as -SourceVersion)` : 'unknown (version not captured: ask for the MariaDB version before recovering)'

// --- ranking -------------------------------------------------------------------------------------------------------------------------
const paths = []
if (dumps > 0 || archives > 0) paths.push({ id: 'A', why: `${dumps} dump/backup candidate file(s) and ${archives} backup archive(s) over 5 MB are on the server: copy them read-only and check what they contain first` })
if (alive) paths.push({ id: 'B1', why: 'MariaDB is alive and answers: a table-limited dump (books, book_media, categories, makers, ...) with --single-transaction reads without locking or changing anything; use the site\'s own credentials on the server, never share them' })
if (physicalOk && !running && !changing) paths.push({ id: 'B2', why: `MariaDB is stopped, nothing is writing to the datadir, and the AAWRAQ files are on disk (books table file ${flags.books_table_file}, ${sysFiles} InnoDB system file(s), MariaDB ${version}, datadir ~${flags.datadir_size_mb ?? '?'} MB): copy the files read-only and recover them on this PC with scripts/migration/recover-from-datadir.ps1 -SourceVersion ${full ? full[1] : '<exact version>'} (image ${recommendedImage}; the EXACT version is required: another major.minor may refuse to replay a crashed redo log)` })
else if (physicalOk) paths.push({ id: 'B2-UNSAFE', unsafe: true, why: `the physical files exist but are NOT a consistent copy source: ${unstableWhy.join('; ') || 'the server state could not be established'}. Do NOT copy this datadir and treat it as a backup, and do not restart, kill or signal MariaDB to make it copyable. Use A, B1 (if it answers) or B3 (a provider backup restored to a NEW server) instead` })
if (hasBooksTable || archives > 0 || (physicalOk && running)) paths.push({ id: 'B3', why: 'a Hostinger backup may hold the data: usable ONLY if hPanel/support can restore it to a NEW, isolated VPS or let you download it. An in-place restore would overwrite the production server (and incident evidence) and is refused' })
if (!paths.some((p) => !p.unsafe)) paths.push({ id: 'C', why: 'no usable and safe source was found on the server (no dump or archive, no stopped-and-static datadir): escalate to Hostinger for a provider backup and its restore options (a restore to a NEW server, never in place)' })
paths.sort((a, b) => Number(!!a.unsafe) - Number(!!b.unsafe)) // an unsafe path is never ranked above a safe one
if (encrypted) paths.unshift({ id: 'STOP', why: 'the MariaDB configuration mentions encryption: encrypted tablespaces cannot be read on another machine without the key files. Stop and discuss before copying anything' })

// --- media picture -------------------------------------------------------------------------------------------------------------------
const media = [...text.matchAll(/^\[([a-z_]+)\] (\S.*?)\s+files=(\d+)\s+bytes=(\d+)/gm)].map((m) => ({ folder: m[1], path: m[2], files: Number(m[3]), bytes: Number(m[4]) }))
const RECOVERED_PRODUCT_FILES = 1060
const sum = (f) => media.filter((m) => m.folder === f).reduce((a, m) => a + m.files, 0)
const covers = sum('product_cover')

// --- deployment gate signals ---------------------------------------------------------------------------------------------------------
const gate = []
if (num('script_like_in_uploads') > 0) gate.push(`${flags.script_like_in_uploads} script-like file(s) inside upload/storage trees`)
if (num('php_tag_in_uploads') > 0) gate.push(`${flags.php_tag_in_uploads} upload file(s) containing a PHP open tag`)
if (num('uid0_accounts') > 1) gate.push(`${flags.uid0_accounts} accounts with UID 0 (expected 1)`)
if (!Number.isFinite(num('script_like_in_uploads'))) gate.push('summary flags missing - the script did not finish; rerun it')
const notes = []
if (flags.php_tag_in_uploads === 'skipped') notes.push('content scan was skipped (NO_CONTENT_SCAN): PHP-tag and webshell-pattern checks were NOT performed')

const report = {
  file, recommended_path: paths[0].id, ranked_paths: paths,
  database: { mariadb_version: version, recommended_recovery_image: recommendedImage, recommended_source_version: full ? full[1] : null, mariadb_unit_state: flags.mariadb_unit_state ?? 'unknown', mariadb_process_state: processState, threads_in_d_state: dThreads, datadir_changing: flags.datadir_changing ?? 'unknown', datadir_consistent_copy_source: physicalOk && !running && !changing, unstable_reasons: unstableWhy, redo_layout: flags.redo_layout ?? 'unknown', undo_layout: flags.undo_layout ?? 'unknown', force_recovery_in_config: flags.force_recovery_in_config ?? 'unknown', mariadb_active: active, mariadb_ping: flags.mariadb_ping ?? 'unknown', alive, datadir: flags.datadir, datadir_size_mb: flags.datadir_size_mb, innodb_system_files: sysFiles, encryption_hint: flags.encryption_hint ?? 'unknown', database_folders: Number(flags.db_dirs ?? 0), books_table_file: flags.books_table_file ?? 'none', table_files: tableFiles, error_log_trouble_lines: innodbTrouble },
  dump_candidates: dumpLines.slice(0, 20), backup_archives: archiveLines.slice(0, 20),
  media: { folders: media, product_media_files_on_vps: num('product_media_files'), recovered_product_files: RECOVERED_PRODUCT_FILES, product_cover_files_on_vps: covers, public_image_folders: Object.fromEntries(['category', 'maker', 'article', 'logo'].map((f) => [f, sum(f)])) },
  gate: { verdict: gate.length ? 'NO-GO (blocking findings)' : 'NO-GO until the owner reviews the full output (this tool cannot prove a host clean)', blocking_findings: gate, notes },
}

if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0) }
const out = []
out.push(`Recommended database recovery path: ${paths[0].id}`)
paths.forEach((p, i) => out.push(`  ${i + 1}. [${p.id}] ${p.why}`))
out.push('', `Recovery image to use (EXACT version): ${recommendedImage}`)
if (unstableWhy.length) out.push(`!! DATADIR IS NOT A CONSISTENT COPY SOURCE: ${unstableWhy.join('; ')}`)
out.push(`MariaDB: version=${version}, service=${active}, ping=${report.database.mariadb_ping}, encryption hint=${report.database.encryption_hint}, datadir=${flags.datadir ?? '?'} (~${flags.datadir_size_mb ?? '?'} MB), InnoDB system files found=${sysFiles}, AAWRAQ database folders=${report.database.database_folders}, books table file=${report.database.books_table_file}`)
if (tableFiles.length) out.push(...tableFiles.slice(0, 12).map((t) => `    ${t}`))
if (innodbTrouble) out.push(`  ! ${innodbTrouble} crash/corruption/disk lines in the MariaDB error log (read them before choosing B2)`)
out.push('', 'Dump / backup candidates:', ...(dumpLines.length ? dumpLines.slice(0, 12).map((l) => `  ${l.trim()}`) : ['  (none)']))
out.push('Backup archives > 5 MB:', ...(archiveLines.length ? archiveLines.slice(0, 12).map((l) => `  ${l.trim()}`) : ['  (none)']))
out.push('', 'Media on the VPS:', ...(media.length ? media.map((m) => `  ${m.folder.padEnd(14)} ${String(m.files).padStart(6)} files  ${(m.bytes / 1048576).toFixed(1)} MiB  ${m.path}`) : ['  (no media folders reported)']))
out.push(`  product files on VPS: ${flags.product_media_files ?? '?'}  (recovered archive had ${RECOVERED_PRODUCT_FILES}) | cover files on VPS: ${covers} (none were in the recovered archive) | public images: ${Object.entries(report.media.public_image_folders).map(([k, v]) => `${k}=${v}`).join(', ')}`)
out.push('', `Deployment gate for a new file service on this host: ${report.gate.verdict}`, ...(gate.length ? gate.map((g) => `  - ${g}`) : ['  - no blocking summary flags; still review sections 5, 6 and 6b by hand']), ...notes.map((n) => `  ! ${n}`))
console.log(out.join('\n'))
