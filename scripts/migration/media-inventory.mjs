// Media inventory + quarantine extraction of the recovered upload archive (UNTRUSTED input).
//   node scripts/migration/media-inventory.mjs [--extract] [--tar <file>] [--quarantine <dir>] [--out <dir>]
//
// For every tar member: content-sniff (magic bytes), SHA-256, hostile-marker scan, classification.
// With --extract only members that pass the pre-checks are written to the quarantine directory (outside the
// project, never served, never executed); a member whose full-content scan finds a hostile marker is deleted again.
// Special tar members (symlink/hardlink/device), absolute / traversal / invalid paths are rejected and never written.
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { OUT_DIR, QUARANTINE, USER_FILES_TAR, WORKSPACE } from './lib/paths.mjs'
import { readTar, entryStream } from './lib/tar.mjs'
import { MarkerScanner, MIME_FOR_TYPE, WEAK_SCAN_MAX_BYTES, classifyFile, oversize, sniffType, unsafePathReason } from './lib/classify.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const tarFile = opt('--tar', USER_FILES_TAR)
const extractRoot = opt('--quarantine', path.join(QUARANTINE, 'user-files'))
const outDir = opt('--out', OUT_DIR)
const extract = flag('--extract')

const csvCell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`
const toCsv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'

async function readManifest() {
  const f = path.join(WORKSPACE, 'docs/legacy-audit/evidence/media-manifest.csv')
  const lines = (await readFile(f, 'utf8')).split(/\r?\n/).slice(1).filter(Boolean)
  const m = new Map()
  for (const l of lines) {
    const mm = l.match(/^"((?:[^"]|"")*)",(\d+),([^,]*),([^,]*),([0-9a-f]{64})$/)
    if (mm) m.set(mm[1].replaceAll('""', '"'), { size: Number(mm[2]), magic: mm[4], sha256: mm[5] })
  }
  return m
}

/** Hash + scan a byte stream; optionally tee it to a file. */
async function consume(entry, { weak, writeTo }) {
  const hash = createHash('sha256')
  const scanner = new MarkerScanner({ weak })
  const tap = new Transform({ transform(chunk, _e, cb) { hash.update(chunk); scanner.update(chunk); cb(null, chunk) } })
  const src = entryStream(tarFile, entry)
  if (writeTo) {
    await mkdir(path.dirname(writeTo), { recursive: true })
    const tmp = `${writeTo}.part`
    await pipeline(src, tap, createWriteStream(tmp, { flags: 'w', mode: 0o600 }))
    await rename(tmp, writeTo)
  } else {
    await pipeline(src, tap, new Transform({ transform(_c, _e, cb) { cb() } }))
  }
  return { sha256: hash.digest('hex'), markers: scanner.found }
}

async function readHead(entry, n = 8192) {
  const len = Math.min(n, entry.size)
  if (len === 0) return Buffer.alloc(0)
  const chunks = []
  for await (const c of entryStream(tarFile, entry, { end: entry.dataOffset + len - 1 })) chunks.push(c)
  return Buffer.concat(chunks)
}

const manifest = await readManifest()
const rows = []
let dirs = 0
let n = 0
const started = Date.now()

for await (const e of readTar(tarFile)) {
  if (e.type === '5') { dirs++; continue }
  const rel = e.name.replace(/^\.\//, '')
  const row = { path: rel, size: e.size, mtime: new Date(e.mtime * 1000).toISOString().replace('T', ' ').slice(0, 19) }

  if (e.type !== '0') { // symlink, hardlink, device, fifo …: never touched
    rows.push({ ...row, detected_type: `tar-type-${e.type}`, sha256: '', accepted: false, reasons: [`special tar member (type ${e.type})`], scope: null })
    continue
  }
  const head = await readHead(e)
  const detected = sniffType(head, e.size)
  const pre = classifyFile({ path: rel, size: e.size, head })
  const weak = e.size <= WEAK_SCAN_MAX_BYTES && detected !== 'pdf'
  const safeTarget = path.join(extractRoot, ...rel.split('/'))
  const inside = path.resolve(safeTarget).startsWith(path.resolve(extractRoot) + path.sep)
  const willExtract = extract && pre.accepted && inside && !unsafePathReason(rel) && !oversize(e.size)

  const { sha256, markers } = await consume(e, { weak, writeTo: willExtract ? safeTarget : null })
  const final = classifyFile({ path: rel, size: e.size, head, markers })
  if (willExtract && !final.accepted) await rm(safeTarget, { force: true }) // hostile content discovered after streaming
  const m = manifest.get(rel)
  rows.push({
    ...row, scope: final.scope, detected_type: final.detected_type, sha256,
    accepted: final.accepted, reasons: final.reasons,
    oversize: oversize(e.size), extracted: willExtract && final.accepted,
    manifest_match: m ? m.sha256 === sha256 && m.size === e.size : null,
    mime_type: MIME_FOR_TYPE[final.detected_type] ?? null,
  })
  if (++n % 100 === 0) console.log(`… ${n} files, ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

// duplicates among accepted files (by SHA-256); canonical = first path in sorted order
const bySha = new Map()
for (const r of rows.filter((r) => r.accepted)) bySha.set(r.sha256, [...(bySha.get(r.sha256) ?? []), r])
const dupGroups = []
for (const [sha, list] of bySha) {
  list.sort((a, b) => a.path.localeCompare(b.path))
  list.slice(1).forEach((r) => { r.duplicate_of = list[0].path })
  if (list.length > 1) dupGroups.push({ sha256: sha, size: list[0].size, copies: list.length, paths: list.map((r) => r.path).join(' | ') })
}

// V6 manifest diff
const seen = new Set(rows.map((r) => r.path))
const diff = {
  manifest_entries: manifest.size,
  inventoried_files: rows.filter((r) => r.sha256).length,
  missing_from_archive: [...manifest.keys()].filter((p) => !seen.has(p)),
  not_in_manifest: rows.filter((r) => r.sha256 && !manifest.has(r.path)).map((r) => r.path),
  hash_or_size_mismatch: rows.filter((r) => r.manifest_match === false).map((r) => r.path),
}

const accepted = rows.filter((r) => r.accepted)
const rejected = rows.filter((r) => !r.accepted)
const product = accepted.filter((r) => r.scope === 'product')
const stamp = (name) => { const m = name.match(/-(\d{10})\.\w+$/); return m ? new Date(Number(m[1]) * 1000).toISOString().slice(0, 10) : '' }
const unmapped = product.map((r) => ({
  path: r.path, size: r.size, sha256: r.sha256, detected_type: r.detected_type,
  duplicate_of: r.duplicate_of ?? '', embedded_upload_date_hint: stamp(r.path),
  status: 'UNMAPPED_MEDIA — no database dump: no book/title/price may be inferred',
}))

const summary = {
  generated_at: new Date().toISOString(), tar: path.basename(tarFile), directories: dirs, files: rows.length,
  accepted: accepted.length, rejected: rejected.length,
  accepted_by_type: Object.fromEntries([...new Set(accepted.map((r) => r.detected_type))].map((t) => [t, accepted.filter((r) => r.detected_type === t).length])),
  rejected_by_reason: rejected.reduce((a, r) => { for (const x of r.reasons) { const k = x.replace(/"[^"]*"/g, '"…"'); a[k] = (a[k] ?? 0) + 1 } return a }, {}),
  product_pdf_or_audio: product.length, unique_product_blobs: new Set(product.map((r) => r.sha256)).size,
  product_bytes: product.reduce((s, r) => s + r.size, 0), oversize_files: rows.filter((r) => r.oversize).map((r) => r.path),
  duplicate_groups: dupGroups.length, extracted_files: rows.filter((r) => r.extracted).length,
  extracted_bytes: rows.filter((r) => r.extracted).reduce((s, r) => s + r.size, 0), quarantine_dir: extract ? extractRoot : null,
  manifest: { entries: diff.manifest_entries, missing_from_archive: diff.missing_from_archive.length, not_in_manifest: diff.not_in_manifest.length, mismatches: diff.hash_or_size_mismatch.length },
}

await mkdir(outDir, { recursive: true })
const cols = ['path', 'size', 'mtime', 'scope', 'detected_type', 'sha256', 'accepted', 'reasons', 'duplicate_of', 'manifest_match', 'extracted']
await writeFile(path.join(outDir, 'inventory.json'), JSON.stringify(rows, null, 1))
await writeFile(path.join(outDir, 'inventory.csv'), toCsv(rows.map((r) => ({ ...r, reasons: r.reasons.join('; ') })), cols))
await writeFile(path.join(outDir, 'rejected.csv'), toCsv(rejected.map((r) => ({ ...r, reasons: r.reasons.join('; ') })), ['path', 'size', 'mtime', 'detected_type', 'sha256', 'reasons']))
await writeFile(path.join(outDir, 'duplicates.csv'), toCsv(dupGroups, ['sha256', 'size', 'copies', 'paths']))
await writeFile(path.join(outDir, 'UNMAPPED_MEDIA.csv'), toCsv(unmapped, ['path', 'size', 'sha256', 'detected_type', 'duplicate_of', 'embedded_upload_date_hint', 'status']))
await writeFile(path.join(outDir, 'manifest-diff.json'), JSON.stringify(diff, null, 2))
await writeFile(path.join(outDir, 'inventory-summary.json'), JSON.stringify(summary, null, 2))
await writeFile(path.join(outDir, 'UNMAPPED_MEDIA.md'), [
  '# UNMAPPED_MEDIA', '',
  `Generated ${summary.generated_at}. The production database was **not** recovered, so none of these files can be attributed to a book.`,
  'No title, price, author or category is inferred from file names. They stay in private staging until the MariaDB dump arrives.', '',
  `- Product files accepted: **${product.length}** (${summary.unique_product_blobs} unique blobs, ${(summary.product_bytes / 2 ** 30).toFixed(3)} GiB)`,
  `- Duplicate groups (SHA-256): ${dupGroups.length}`, `- Rejected members: ${rejected.length} (see rejected.csv)`, '',
  'Full list: `UNMAPPED_MEDIA.csv`. The `embedded_upload_date_hint` column is only a clustering aid (upload session), not metadata.',
].join('\n'))
void stat
console.log(JSON.stringify(summary, null, 2))
