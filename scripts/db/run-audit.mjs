// Runs scripts/db/audit-security.sql against the LOCAL database container (read-only) and fails on unexpected findings.
// The same SQL can be executed against the hosted project later through the Supabase MCP `execute_sql` tool.
//   node scripts/db/run-audit.mjs [container-name]
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const container = process.argv[2] ?? 'supabase_db_aawraq-local'
const sql = readFileSync(new URL('./audit-security.sql', import.meta.url), 'utf8')
const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
if (r.status !== 0) { console.error(r.stderr || r.stdout || 'psql failed'); process.exit(2) }

// Findings that are intentional and reviewed (documented in docs/implementation/RLS_PERMISSION_MATRIX.md).
const ALLOWED = [
  /^definer_exposed:anon\|(book_comments|site_totals)\(/,                            // public RPCs: approved comments listing, aggregate counters
  /^definer_exposed:authenticated\|(is_admin|is_affiliate|owns_book|affiliate_balance|book_comments|site_totals)\(/, // answer only about the caller; affiliate_balance checks ownership inside
  /^write_grant:authenticated\|(favourites:DELETE|payout_methods:DELETE,INSERT,UPDATE)$/, // own rows only, RLS-enforced
]
const findings = r.stdout.split(/\r?\n/).filter((l) => l.includes('|') && !l.startsWith('lint'))
const unexpected = findings.filter((f) => !ALLOWED.some((re) => re.test(f)))
console.log(`audit findings: ${findings.length} (reviewed/allowed: ${findings.length - unexpected.length}, unexpected: ${unexpected.length})`)
for (const f of findings) console.log(`${unexpected.includes(f) ? 'UNEXPECTED' : 'allowed   '}  ${f}`)
process.exit(unexpected.length ? 1 : 0)
