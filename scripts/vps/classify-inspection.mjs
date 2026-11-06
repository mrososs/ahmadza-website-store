// Reads the SANITISED output of scripts/vps/readonly-inspect.sh and recommends the database recovery path (A / B / C) from
// docs/implementation/VPS_RECOVERY_RUNBOOK.md, plus the media picture and the deployment gate signals. OFFLINE: it only reads that one text file.
//   node scripts/vps/classify-inspection.mjs D:\mostqel\vps-inspection\aawraq-inspect.txt [--json]
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) { console.error('usage: classify-inspection.mjs <aawraq-inspect.txt> [--json]'); process.exit(2) }
const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

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
const innodbTrouble = lines(section(/^\s*InnoDB \/ recovery \/ corruption lines/m, /^=== /m)).filter((l) => /corrupt|crash|abort|no space|disk full/i.test(l)).length

// --- decision ------------------------------------------------------------------------------------------------------------------------
const reasons = []
let path = 'C'
if (dumps > 0 || archives > 0) {
  path = 'A'
  reasons.push(`${dumps} dump/backup candidate file(s) and ${archives} backup archive(s) over 5 MB are present — inspect them first`)
  if (hasBooksTable) reasons.push('the MariaDB data directory ALSO holds a books table file → path B is the fallback if no candidate contains the database')
} else if (hasBooksTable) {
  path = 'B'
  reasons.push(`no dump or backup archive found, but the data directory holds the AAWRAQ table files (${flags.books_table_file}) → clone-and-dump from a provider snapshot`)
} else {
  reasons.push('no dump, no backup archive and no AAWRAQ table files were found in the data directory → escalate to Hostinger for the oldest provider backup')
}

// --- media picture -------------------------------------------------------------------------------------------------------------------
const media = [...text.matchAll(/^\[([a-z_]+)\] (\S.*?)\s+files=(\d+)\s+bytes=(\d+)/gm)].map((m) => ({ folder: m[1], path: m[2], files: Number(m[3]), bytes: Number(m[4]) }))
const RECOVERED_PRODUCT_FILES = 1060
const covers = media.filter((m) => m.folder === 'product_cover').reduce((a, m) => a + m.files, 0)

// --- deployment gate signals ---------------------------------------------------------------------------------------------------------
const gate = []
if (num('script_like_in_uploads') > 0) gate.push(`${flags.script_like_in_uploads} script-like file(s) inside upload/storage trees`)
if (num('php_tag_in_uploads') > 0) gate.push(`${flags.php_tag_in_uploads} upload file(s) containing a PHP open tag`)
if (num('uid0_accounts') > 1) gate.push(`${flags.uid0_accounts} accounts with UID 0 (expected 1)`)
if (!Number.isFinite(num('script_like_in_uploads'))) gate.push('summary flags missing — the script did not finish; rerun it')

const report = {
  file, recommended_path: path, reasons,
  database: { mariadb_active: flags.mariadb_active ?? 'unknown', mariadb_ping: flags.mariadb_ping ?? 'unknown', datadir: flags.datadir, database_folders: Number(flags.db_dirs ?? 0), books_table_file: flags.books_table_file ?? 'none', table_files: tableFiles, innodb_trouble_lines: innodbTrouble },
  dump_candidates: dumpLines.slice(0, 20), backup_archives: archiveLines.slice(0, 20),
  media: { folders: media, product_media_files_on_vps: num('product_media_files'), recovered_product_files: RECOVERED_PRODUCT_FILES, product_cover_files_on_vps: covers },
  gate: { verdict: gate.length ? 'NO-GO (blocking findings)' : 'NO-GO until the owner reviews the full output (this tool cannot prove a host clean)', blocking_findings: gate },
}

if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0) }
const out = []
out.push(`Recommended database recovery path: ${path}`, ...reasons.map((r) => `  - ${r}`))
out.push('', `MariaDB: service=${report.database.mariadb_active}, ping=${report.database.mariadb_ping}, AAWRAQ database folders in datadir=${report.database.database_folders}, books table file=${report.database.books_table_file}`)
if (tableFiles.length) out.push(...tableFiles.slice(0, 12).map((t) => `    ${t}`))
if (innodbTrouble) out.push(`  ! ${innodbTrouble} crash/corruption/disk lines in the MariaDB error log (read them before choosing B)`)
out.push('', 'Dump / backup candidates:', ...(dumpLines.length ? dumpLines.slice(0, 12).map((l) => `  ${l.trim()}`) : ['  (none)']))
out.push('Backup archives > 5 MB:', ...(archiveLines.length ? archiveLines.slice(0, 12).map((l) => `  ${l.trim()}`) : ['  (none)']))
out.push('', 'Media on the VPS:', ...(media.length ? media.map((m) => `  ${m.folder.padEnd(14)} ${String(m.files).padStart(6)} files  ${(m.bytes / 1048576).toFixed(1)} MiB  ${m.path}`) : ['  (no media folders reported)']))
out.push(`  product files on VPS: ${flags.product_media_files ?? '?'}  (recovered archive had ${RECOVERED_PRODUCT_FILES}) · cover files on VPS: ${covers} (none were in the recovered archive)`)
out.push('', `Deployment gate for a new file service on this host: ${report.gate.verdict}`, ...(gate.length ? gate.map((g) => `  - ${g}`) : ['  - no blocking summary flags; still review sections 5, 6 and 6b by hand']))
console.log(out.join('\n'))
