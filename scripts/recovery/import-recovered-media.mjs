// Creates evidence-based DRAFT books from recovered PDFs whose own metadata gives a clear title.   DEFAULT IS A DRY RUN.
//   node scripts/recovery/import-recovered-media.mjs [--dry-run] [--limit N] [--quarantine <dir>] [--staging-source dev|inventory]
//   node scripts/recovery/import-recovered-media.mjs --apply --target recovery        (writes, recovery stack only)
// One draft per distinct SHA-256: provenance recovered_media, status draft, price 0, no category/maker, evidence in recovery_evidence.
// Eligible: PDF title passes classifyTitle, no active content, not encrypted, and the file is 'staged' (validated, clean scan) in
// legacy_media_staging. Insert-only and idempotent. The dry run never connects to the import target; it reads the staging table of the
// LOCAL dev database (SELECT only) or, if that is unreachable, the inventory (staging then unverified, reported as such).
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { OUT_DIR, QUARANTINE } from '../migration/lib/paths.mjs'
import { serviceClient } from '../migration/lib/supabase.mjs'
import { checkRecoveryStackIsClean, checkTargetPolicy, countSynthetic, loadTargetEnv } from '../migration/lib/target.mjs'
import { collectPdfEvidence, readJsonFile } from './lib/evidence-collect.mjs'
import { applyImport, evidenceRows, groupBySha, loadExistingKeys, planImport, summarisePlan } from './lib/recovered-media-import.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const apply = flag('--apply')
if (apply && flag('--dry-run')) { console.error('--apply and --dry-run are mutually exclusive'); process.exit(2) }
const target = opt('--target', apply ? undefined : 'recovery') // a write must name its target explicitly
const root = opt('--quarantine', path.join(QUARANTINE, 'user-files'))
const limit = Number(opt('--limit', Infinity))
const sourceOpt = opt('--staging-source', 'dev')
if (!['dev', 'inventory'].includes(sourceOpt)) { console.error('--staging-source must be dev or inventory (a write always reads the staging table of the target itself)'); process.exit(2) }

// ---- target policy: real recovered data goes only to the isolated recovery stack -----------------------------------------------------------
const { env, devEnv } = loadTargetEnv(target)
const policy = checkTargetPolicy({ target, sourceKind: 'recovered_media', targetEnv: env, devEnv })
if (apply && !policy.ok) {
  console.error(['IMPORT REFUSED (target policy):', ...policy.problems.map((m, i) => `  ${i + 1}. ${m}`)].join('\n'))
  process.exit(2)
}

// ---- staging rows ---------------------------------------------------------------------------------------------------------------------------
let db = null
let staging
let stagingSource = apply ? 'target' : sourceOpt
const warnings = []
const readStaging = async (client) => {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from('legacy_media_staging').select('id,legacy_path,sha256,byte_size,detected_type,scope,status,duplicate_of,book_media_id,storage_path').order('id').range(from, from + 999)
    if (error) throw error
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}
try {
  if (apply) {
    db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const clean = checkRecoveryStackIsClean(await countSynthetic(db))
    if (!clean.ok) { console.error('IMPORT REFUSED: the recovery stack contains synthetic data (' + clean.problems.join('; ') + ').'); process.exit(2) }
    staging = await readStaging(db)
  } else if (sourceOpt === 'dev') {
    db = serviceClient().db // read-only use: SELECT on the local dev database
    staging = await readStaging(db)
  }
} catch (e) {
  if (apply) { console.error(`IMPORT REFUSED: cannot read the target staging table (${String(e.message ?? e).slice(0, 160)}). Is the recovery stack running and staged?`); process.exit(2) }
  warnings.push(`staging table not readable (${String(e.message ?? e).slice(0, 120)}): falling back to the inventory; staging status is UNVERIFIED`)
  db = null
}
if (!staging) {
  stagingSource = 'inventory'
  const inventory = await readJsonFile(path.join(OUT_DIR, 'inventory.json'))
  staging = inventory.filter((r) => r.accepted && r.extracted).map((r) => ({
    id: null, legacy_path: r.path, sha256: r.sha256, byte_size: r.size, detected_type: r.detected_type, scope: r.scope, status: 'inventoried', duplicate_of: null, book_media_id: null,
  }))
}
const assumeStaged = stagingSource === 'inventory'

// ---- evidence only for the canonical file of each distinct blob -------------------------------------------------------------------------------
const groups = groupBySha(staging, { assumeStaged })
const collected = await collectPdfEvidence(evidenceRows(groups), { root, concurrency: 4 })
const evidence = new Map([...collected].map(([p, v]) => [p, v.problems.length ? { ok: false, reason: v.problems.join(',') } : v.analysis]))

let existing = { evidenceShas: new Set(), mediaShas: new Set() }
if (db && stagingSource !== 'inventory') existing = await loadExistingKeys(db, groups.map((g) => g.sha))
else warnings.push('existing drafts could not be checked (no database): idempotence is enforced at apply time')

const plan = planImport({ staging, evidence, existing, assumeStaged, limit })
const summary = { mode: apply ? 'apply' : 'dry-run', target, staging_source: stagingSource, target_policy: policy.ok ? 'ok' : policy.problems, ...summarisePlan(plan), warnings }
const result = { ...summary }
if (apply) result.applied = await applyImport(db, plan)
await mkdir(OUT_DIR, { recursive: true })
const file = path.join(OUT_DIR, `recovered-media-import-${apply ? 'apply' : 'dry-run'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
await writeFile(file, JSON.stringify({ ...result, would_create_items: plan.create.map((c) => ({ sha256: c.sha256, staging_id: c.staging_id, title: c.title, duplicate_paths: c.duplicate_paths })), skipped_items: plan.skipped }, null, 2))
console.log(JSON.stringify({ ...result, applied: result.applied ? { created: result.applied.created.length, failed: result.applied.failed.length } : undefined, report: file }, null, 2))
if (result.applied?.failed.length) process.exit(1)
