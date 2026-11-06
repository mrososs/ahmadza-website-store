// Hosted-Supabase preflight. READ-ONLY and OFFLINE: it never contacts any Supabase project.
// It validates the configured target, inventories the local migrations (name + SHA-256) and flags statements that
// must be reviewed before they run on a database that may already contain data.
//   node scripts/db/hosted-preflight.mjs [--env .env.hosted] [--write-inventory]
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget.ts'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const args = process.argv.slice(2)
const envFile = args.includes('--env') ? args[args.indexOf('--env') + 1] : '.env.hosted'

let failed = false
const fail = (m) => { failed = true; console.error(`FAIL  ${m}`) }
const ok = (m) => console.log(`ok    ${m}`)

// 1. target
const envPath = join(root, envFile)
if (existsSync(envPath)) {
  const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  try {
    const t = assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL, { production: false })
    if (t.kind === 'hosted') ok(`${envFile}: hosted project ${t.ref} is the authorised AAWRAQ project`)
    else console.log(`note  ${envFile} points at a LOCAL stack`)
  } catch (e) { fail(`${envFile}: ${e.message}`) }
  if (!env.NUXT_PUBLIC_SUPABASE_KEY || env.NUXT_PUBLIC_SUPABASE_KEY.startsWith('<')) fail(`${envFile}: NUXT_PUBLIC_SUPABASE_KEY is not set`)
  if (!env.NUXT_SUPABASE_SECRET_KEY || env.NUXT_SUPABASE_SECRET_KEY.startsWith('<')) fail(`${envFile}: NUXT_SUPABASE_SECRET_KEY is not set`)
  if (String(env.NUXT_ALLOW_DEV_PAYMENT_SIMULATOR).toLowerCase() === 'true') fail(`${envFile}: the development payment simulator must be OFF against the hosted project`)
  if (/supabase/.test(env.NUXT_MEDIA_ENABLED_PROVIDERS ?? '')) fail(`${envFile}: hosted environments must not enable the "supabase" media provider (VPS phase pending)`)
} else {
  console.log(`note  ${envFile} not found — nothing to validate yet (copy .env.hosted.example and fill the keys; never commit it)`)
}
console.log(`info  authorised hosted project ref: ${AUTHORIZED_SUPABASE_REF}`)

// 2. migrations
const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const versions = files.map((f) => f.split('_')[0])
if (new Set(versions).size !== versions.length) fail('duplicate migration versions')
if (versions.some((v, i) => i && v <= versions[i - 1])) fail('migration versions are not strictly ascending')
ok(`${files.length} local migrations, strictly ordered`)

const inventory = []
const review = []
for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8')
  inventory.push({ file: f, sha256: createHash('sha256').update(sql).digest('hex'), bytes: Buffer.byteLength(sql) })
  sql.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*--/.test(line)) return
    if (/\b(drop\s+table|drop\s+schema|drop\s+column|truncate\b|drop\s+type)\b/i.test(line)) review.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`)
    if (/\bdelete\s+from\b/i.test(line) && !/^\s*(delete from public\.(books|articles|pages|makers|categories)|delete from public\.\w+ \w* *where is_demo)/i.test(line)) review.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`)
  })
}
if (review.length) { console.log('REVIEW statements that destroy data/structure (must be inside function bodies or empty-table only):'); review.forEach((r) => console.log('   ' + r)) } else ok('no destructive DDL/DML outside reviewed demo-purge function bodies')
const seedRef = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8').match(/\[db\.seed\][\s\S]*?enabled = (\w+)/)?.[1]
console.log(`info  seed.sql is local-only (db.seed.enabled=${seedRef}); \`supabase db push\` never runs it — do NOT run it on the hosted project`)

if (args.includes('--write-inventory')) {
  writeFileSync(join(root, 'docs', 'implementation', 'migration-inventory.json'), JSON.stringify({ authorised_project_ref: AUTHORIZED_SUPABASE_REF, migrations: inventory }, null, 2))
  ok('wrote docs/implementation/migration-inventory.json')
}
process.exit(failed ? 1 : 0)
