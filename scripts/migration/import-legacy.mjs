// Legacy MariaDB -> local Supabase importer.   node scripts/migration/import-legacy.mjs [flags]
//   --dump <file>            the SQL dump (signature-checked; it must already be restored into a LOCAL throw-away MariaDB)
//   --dry-run                run every transform/validation, write NOTHING
//   --phases a,b,c           default: settings,categories,makers,books,book_media,related_books,articles,pages
//   --sensitive              add customer/financial phases (users, orders, affiliates, comments, favourites,
//                            contact_messages, contributor_requests, payout_methods)
//   --owner-authorised --confirm "<exact sentence printed by --help-confirm>"   required with --sensitive
//   --include-pii            also copy phone/country/region of users (otherwise only e-mail + display name)
//   --grant-test-entitlements  grant access for legacy test-mode orders (default: no)
// Env (restored copy only, read-only account): LEGACY_DB_HOST(127.0.0.1) LEGACY_DB_PORT LEGACY_DB_NAME LEGACY_DB_USER LEGACY_DB_PASSWORD
// Never imported: password hashes, default_password, remember/reset tokens.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OUT_DIR } from './lib/paths.mjs'
import { OWNER_CONFIRMATION, createMariaDbSource, preflight } from './lib/source.mjs'
import { CATALOG_PHASES, SENSITIVE_PHASES, runImport } from './lib/importer.mjs'
import { sanitizeRichText } from './lib/sanitize.mjs'
import { createClient } from '@supabase/supabase-js'
import { checkRecoveryStackIsClean, checkTargetPolicy, countSynthetic, loadTargetEnv } from './lib/target.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
if (flag('--help-confirm')) { console.log(OWNER_CONFIRMATION); process.exit(0) }

const sensitive = flag('--sensitive')
const phases = opt('--phases') ? opt('--phases').split(',') : [...CATALOG_PHASES, ...(sensitive ? SENSITIVE_PHASES : [])]
const cfg = {
  dumpPath: opt('--dump', process.env.LEGACY_DUMP_PATH),
  dbHost: process.env.LEGACY_DB_HOST, dbName: process.env.LEGACY_DB_NAME, dbUser: process.env.LEGACY_DB_USER,
  ownerAuthorised: flag('--owner-authorised'), confirm: opt('--confirm'),
  sensitive: sensitive || phases.some((p) => SENSITIVE_PHASES.includes(p)),
}
const pre = await preflight(cfg)
await mkdir(OUT_DIR, { recursive: true })
if (!pre.ready) {
  const report = { ready: false, missing_inputs: pre.missing, notes: pre.notes, checked_at: new Date().toISOString() }
  await writeFile(path.join(OUT_DIR, 'import-preflight.json'), JSON.stringify(report, null, 2))
  console.error('IMPORT REFUSED — missing inputs:\n' + pre.missing.map((m, i) => `  ${i + 1}. ${m}`).join('\n'))
  process.exit(2)
}

// ---- which stack may this run write to? Real recovered data only ever goes to the isolated recovery stack -----------------------------
const target = opt('--target')
if (!flag('--dry-run')) {
  const { env, devEnv } = loadTargetEnv(target ?? 'recovery')
  const policy = checkTargetPolicy({ target, sourceKind: 'mariadb', targetEnv: env, devEnv })
  if (!policy.ok) { console.error(['IMPORT REFUSED (target policy):', ...policy.problems.map((m, i) => `  ${i + 1}. ${m}`)].join('\n')); process.exit(2) }
}

const source = await createMariaDbSource({ host: cfg.dbHost, port: Number(process.env.LEGACY_DB_PORT ?? 3306), user: cfg.dbUser, password: process.env.LEGACY_DB_PASSWORD, database: cfg.dbName })
try {
  let db = null
  if (!flag('--dry-run')) {
    const { env } = loadTargetEnv(target)
    db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const clean = checkRecoveryStackIsClean(await countSynthetic(db))
    if (!clean.ok) { console.error('IMPORT REFUSED: the recovery stack contains synthetic data (' + clean.problems.join('; ') + '). Real data is never mixed with test data; recreate the recovery stack.'); process.exit(2) }
    console.log(`target: ${target} stack at ${env.NUXT_PUBLIC_SUPABASE_URL} (verified free of synthetic data)`)
  }
  const result = await runImport({
    source, db, dryRun: flag('--dry-run'), phases, sanitize: sanitizeRichText,
    includePii: flag('--include-pii'), grantTestEntitlements: flag('--grant-test-entitlements'),
  })
  const file = path.join(OUT_DIR, `import-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await writeFile(file, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ report: file, dryRun: result.dryRun, counts: result.counts, rejects: result.rejects.length, warnings: result.warnings.length, reconciliation: result.reconciliation }, null, 2))
} finally { await source.close?.() }
