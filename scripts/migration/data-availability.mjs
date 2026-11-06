// Step 1 of the historical import: what data really exists? (read-only)
//   node scripts/migration/data-availability.mjs [--skip-hash]
// - verifies the recovered archives against docs/legacy-audit/evidence/archive-sha256.txt (streamed)
// - looks for any SQL / MariaDB / SQLite dump in the workspace and in both archive member lists
// - never extracts or executes anything
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { ROOT, OUT_DIR, WORKSPACE, ARCHIVES } from './lib/paths.mjs'

const DUMP_NAME = /\.(sql|sql\.gz|sql\.zip|dump|bak|sqlite3?|db|mdb|frm|ibd|myd|myi)$|dump|backup|mysqldump/i
const skipHash = process.argv.includes('--skip-hash')

const sha256File = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256')
  createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
})

async function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.nuxt', '.output', '.git', 'migration-output', 'new-platform'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p, out, depth + 1)
    else out.push(p)
  }
  return out
}

function listMembers(archive, gz) {
  const r = spawnSync('tar', ['--force-local', gz ? '-tzf' : '-tf', archive], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`tar listing failed: ${r.stderr}`)
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

const expected = Object.fromEntries(
  (await readFile(path.join(WORKSPACE, 'docs/legacy-audit/evidence/archive-sha256.txt'), 'utf8')).split(/\r?\n/).filter(Boolean)
    .map((l) => { const [h, n] = l.split(/\s+\*?/); return [n, h] }),
)

const report = { generated_at: new Date().toISOString(), archives: {}, workspace_dump_candidates: [], verdict: '' }
for (const a of ARCHIVES) {
  const st = await stat(a.file)
  const members = listMembers(a.file, a.gz)
  // source-code files that merely mention "backup" (Laravel backup package, translations) are not dumps
  const hits = members.filter((m) => !m.endsWith('/') && !/\.php$/.test(m) && !/Thumbs\.db$/i.test(m)
    && (DUMP_NAME.test(m) || /(^|\/)\.env(\.|$)/.test(m)))
  report.archives[a.name] = {
    bytes: st.size,
    entries: members.length,
    sha256_expected: expected[a.name] ?? null,
    sha256_actual: skipHash ? '(skipped)' : await sha256File(a.file),
    dump_like_members: hits,
    env_files_present: hits.filter((m) => /\.env/.test(m)),
  }
  const r = report.archives[a.name]
  r.sha256_match = skipHash ? null : r.sha256_actual === r.sha256_expected
}
for (const f of await walk(WORKSPACE)) if (DUMP_NAME.test(path.basename(f)) && !/\.(md|mjs|ts|vue|json|png|css|html|js)$/.test(f)) report.workspace_dump_candidates.push(f)

const archiveHits = Object.values(report.archives).flatMap((a) => a.dump_like_members)
report.verdict = archiveHits.length || report.workspace_dump_candidates.length
  ? 'CANDIDATES FOUND — inspect manually; do not assume a .sql extension is a valid dump'
  : 'NO DATABASE DUMP AVAILABLE (workspace + both archive member lists)'
await mkdir(OUT_DIR, { recursive: true })
await writeFile(path.join(OUT_DIR, 'data-availability.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ verdict: report.verdict, archives: Object.fromEntries(Object.entries(report.archives).map(([k, v]) => [k, { bytes: v.bytes, entries: v.entries, sha256_match: v.sha256_match, dump_like: v.dump_like_members.length }])) }, null, 2))
void ROOT
