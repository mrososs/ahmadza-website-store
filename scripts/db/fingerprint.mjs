// Runs scripts/db/schema-fingerprint.sql against the LOCAL database container (read-only) and writes the result as JSON.
//   node scripts/db/fingerprint.mjs [--detail] [--out migration-output/fingerprint-local.json] [--emit-sql]
// --emit-sql prints the exact SQL to paste into the hosted project's SQL runner (MCP execute_sql) instead of running anything.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const detail = args.includes('--detail')
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : `migration-output/fingerprint-local${detail ? '-detail' : ''}.json`
let sql = readFileSync(new URL('./schema-fingerprint.sql', import.meta.url), 'utf8')
if (detail) {
  const lines = sql.split(/\r?\n/)
  const detailLine = lines.find((l) => l.startsWith('-- DETAIL-LINE: '))?.slice('-- DETAIL-LINE: '.length)
  const finalIdx = lines.findIndex((l) => /^select section, .* from fp order by section;$/.test(l))
  if (!detailLine || finalIdx < 0) throw new Error('fingerprint SQL markers not found')
  lines[finalIdx] = detailLine
  sql = lines.join('\n')
}
if (args.includes('--emit-sql')) { process.stdout.write(sql); process.exit(0) }

const container = 'supabase_db_aawraq-local' // local stack only: this script never takes a connection string
const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (r.status !== 0) { console.error(r.stderr || r.stdout || 'psql failed'); process.exit(2) }
const rows = r.stdout.split(/\r?\n/).filter(Boolean).map((l) => {
  const [section, n, digest, entries] = l.split('\t')
  return { section, n: Number(n), digest, ...(entries ? { entries: JSON.parse(entries) } : {}) }
})
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(rows, null, 2))
console.log(`wrote ${out}`)
for (const row of rows) console.log(`${row.section.padEnd(16)} n=${String(row.n).padEnd(5)} ${row.digest}`)
