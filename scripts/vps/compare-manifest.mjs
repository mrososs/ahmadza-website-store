// Compare the VPS manifest produced by scripts/vps/readonly-inspect.sh (MANIFEST=…) with the recovered-archive manifest.
// OFFLINE and read-only: only reads two files. Never opens the media itself.
//   node scripts/vps/compare-manifest.mjs <vps-manifest.tsv> [--local ../docs/legacy-audit/evidence/media-manifest.csv] [--out migration-output/vps-compare.json]
// Reports: files only on the VPS (e.g. the missing covers/branding), files only in the recovered archive, size/hash differences,
// per-folder counts, and risky extensions (never to be imported).
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const vpsFile = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--local' && args[args.indexOf(a) - 1] !== '--out')
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
if (!vpsFile) { console.error('usage: compare-manifest.mjs <vps-manifest.tsv> [--local file.csv] [--out report.json]'); process.exit(2) }
const localFile = opt('--local', '../docs/legacy-audit/evidence/media-manifest.csv')

/** `/home/aawraq.com/public_html/storage/app/public/x` and `.../public/storage/x` -> site-relative, symlink alias folded. */
function rel(p) {
  let r = p.includes('/public_html/') ? p.slice(p.indexOf('/public_html/') + '/public_html/'.length) : p.replace(/^\/+/, '')
  if (r.startsWith('public/storage/')) r = 'storage/app/public/' + r.slice('public/storage/'.length)
  return r
}
const RISKY = /\.(php\d?|phtml|phar|sh|pl|py|cgi|jsp|aspx?|htaccess)$|(^|\/)\.[^/]+$/i
const folder = (r) => r.split('/').slice(0, r.startsWith('storage/app/public/') ? 4 : 3).join('/')

const vps = new Map()
for (const line of readFileSync(vpsFile, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue
  const [path, size, mtime, sha] = line.split('\t')
  const r = rel(path)
  if (!vps.has(r)) vps.set(r, { size: Number(size), mtime: (mtime ?? '').slice(0, 19), sha256: (sha ?? '').trim() || null })
}

const local = new Map()
const rows = readFileSync(localFile, 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
for (const row of rows) {
  const m = /^"?(.*?)"?,(\d+),([^,]*),([^,]*),([0-9a-f]{64})$/.exec(row)
  if (m) local.set(rel(m[1]), { size: Number(m[2]), sha256: m[5] })
}

const onlyVps = []; const onlyLocal = []; const differs = []; let same = 0
for (const [r, v] of vps) {
  const l = local.get(r)
  if (!l) onlyVps.push(r)
  else if (l.size !== v.size || (v.sha256 && v.sha256 !== l.sha256)) differs.push({ path: r, vps: v.size, local: l.size, hashChecked: Boolean(v.sha256) })
  else same++
}
for (const r of local.keys()) if (!vps.has(r)) onlyLocal.push(r)

const byFolder = (list) => Object.entries(list.reduce((a, r) => ((a[folder(r)] = (a[folder(r)] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1])
const report = {
  generated_at: new Date().toISOString(),
  vps_files: vps.size, recovered_files: local.size, identical: same,
  hashes_compared: [...vps.values()].some((v) => v.sha256),
  only_on_vps: { count: onlyVps.length, by_folder: byFolder(onlyVps), sample: onlyVps.slice(0, 25) },
  only_in_recovered_archive: { count: onlyLocal.length, by_folder: byFolder(onlyLocal), sample: onlyLocal.slice(0, 25) },
  size_or_hash_differs: { count: differs.length, sample: differs.slice(0, 25) },
  risky_extensions_on_vps: [...vps.keys()].filter((r) => RISKY.test(r)),
  note: 'Files only on the VPS still need the quarantine + magic-byte + antivirus pipeline before any import; risky names are never imported.',
}
const out = opt('--out', null)
if (out) writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, only_on_vps: { ...report.only_on_vps, sample: report.only_on_vps.sample.slice(0, 5) }, only_in_recovered_archive: { ...report.only_in_recovered_archive, sample: [] }, size_or_hash_differs: { count: differs.length } }, null, 2))
