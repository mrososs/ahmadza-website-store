// Verifies the HOSTED project after YOU applied migrations 18 and 19 with the Supabase CLI.
//   node scripts/db/verify-hosted-after-push.mjs --confirm ubjuyeccioflhpcpnhmo [--list-only]
// 1. every local migration is applied remotely (19 of 19), and nothing remote is unknown locally;
// 2. (unless --list-only) the hosted suites run: RLS, Nuxt integration and the migration 18/19 security checks (tests/hosted/*), against ONLY the authorised project;
// 3. prints the two remaining checks that need the Supabase dashboard / MCP: the schema fingerprint comparison and the Security + Performance Advisors.
// It reads (migration list) and runs the tagged-fixture hosted tests; it never pushes, never resets, never touches another project.
import { spawnSync } from 'node:child_process'
import { AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget.ts'

const args = process.argv.slice(2)
if (args[args.indexOf('--confirm') + 1] !== AUTHORIZED_SUPABASE_REF) { console.error(`refusing: pass --confirm ${AUTHORIZED_SUPABASE_REF}`); process.exit(2) }
const run = (cmd, a, env = {}) => spawnSync(cmd, a, { encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, ...env } })
const lines = (t) => t.split(/\r?\n/)
const VERSION = /^\d{14}$/

console.log('1. migration history (read-only)')
const list = run('npx', ['supabase', 'migration', 'list', '--remote'])
const text = `${list.stdout}\n${list.stderr}`
// CLI v3 prints JSON: {"migrations":[{"local":"2026...","remote":"2026..." or "","time":"..."}]}; older versions print a table
const jsonLine = lines(text).find((l) => l.trim().startsWith('{"migrations"'))
const entries = jsonLine
  ? JSON.parse(jsonLine).migrations.map((m) => ({ local: m.local || '', remote: m.remote || '' }))
  : lines(text).map((l) => l.split('|').map((c) => c.trim())).filter((c) => c.length >= 2 && VERSION.test(c[0] || c[1])).map((c) => ({ local: c[0], remote: c[1] }))
if (!entries.length) { console.error(`could not read the migration list:\n${text.slice(-800)}`); process.exit(1) }
const local = entries.filter((e) => VERSION.test(e.local)).map((e) => e.local)
const remote = entries.filter((e) => VERSION.test(e.remote)).map((e) => e.remote)
const pending = local.filter((v) => !remote.includes(v))
const unknownRemote = remote.filter((v) => !local.includes(v))
console.log(`   local ${local.length}, applied remotely ${local.length - pending.length}, pending ${pending.length ? pending.join(', ') : 'none'}, unknown on remote ${unknownRemote.length ? unknownRemote.join(', ') : 'none'}`)
let ok = local.length === 19 && !pending.length && !unknownRemote.length
console.log(ok ? '   OK: 19 of 19' : `   NOT OK: expected 19 of 19 applied (found ${local.length - pending.length} of ${local.length})`)

if (!args.includes('--list-only')) {
  if (!ok) { console.error('\nStop here: apply the pending migrations first (npx supabase db push --remote), then rerun.'); process.exit(1) }
  console.log('\n2. hosted suites (tagged fixtures, removed afterwards)')
  // tests/hosted/nuxt-hosted.test.ts talks to a Nuxt server on port 3100 that is connected to the hosted project (npm run dev:hosted:3100); it only runs with --nuxt
  const files = args.includes('--nuxt') ? [] : ['rls-hosted', 'release-hosted']
  if (!args.includes('--nuxt')) console.log('   (the Nuxt integration suite is skipped: start `npm run dev:hosted:3100`, then rerun with --nuxt)')
  const t = run('npx', ['vitest', 'run', '-c', 'vitest.hosted.config.ts', ...files], { HOSTED_TEST_CONFIRM: AUTHORIZED_SUPABASE_REF })
  console.log(lines(t.stdout).filter((l) => /Test Files|Tests |FAIL|✓|×/.test(l)).join('\n'))
  ok = ok && t.status === 0
  console.log(t.status === 0 ? '   OK' : `   FAILED\n${(t.stdout + t.stderr).slice(-1500)}`)
}

console.log(`
3. Still to do after this script (needs the Supabase dashboard or the MCP tools, never a different project):
   a. schema fingerprint: run  node scripts/db/fingerprint.mjs --emit-sql  against the hosted project, save the rows as JSON, then
        node scripts/db/compare-fingerprint.mjs migration-output/fingerprint-local.json <hosted.json>      (all 12 sections must match)
   b. Security and Performance Advisors (Dashboard, Advisors): no new ERROR-level finding; list any WARN for review.`)
process.exit(ok ? 0 : 1)
