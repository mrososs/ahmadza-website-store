// Which Supabase stack a migration run may write to. Real recovered data and synthetic development data must NEVER share a database:
//   * 'dev'      = the everyday local stack (.env). It holds seed data and test users. Only fixture/mock sources may write there.
//   * 'recovery' = the isolated stack for REAL recovered data (.env.recovery, its own project id, ports and volumes). Never seeded.
// The checks below are pure so they can be unit-tested; the CLI calls them before it opens any connection that can write.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT } from './paths.mjs'

export function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
}
const isLoopback = (u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u ?? '')

/** @returns {{ ok: boolean, problems: string[] }} */
export function checkTargetPolicy({ target, sourceKind, targetEnv, devEnv }) {
  const problems = []
  if (target !== 'dev' && target !== 'recovery') problems.push(`--target must be "recovery" or "dev" (got ${JSON.stringify(target)}). Real recovered data goes to "recovery".`)
  if (sourceKind === 'mariadb' && target === 'dev') problems.push('real recovered data must NEVER be imported into the dev database (it holds synthetic books and test users). Use --target recovery.')
  if (sourceKind === 'fixture' && target === 'recovery') problems.push('fixture/mock data must NEVER be written to the recovery stack, which is reserved for real recovered data.')
  // draft books built from real recovered PDFs: real data, so recovery only (and, through the loopback check below, never a hosted project)
  if (sourceKind === 'recovered_media' && target !== 'recovery') problems.push('books built from recovered media are real recovered data: they may ONLY be written with --target recovery (never the dev database, never a hosted project).')
  if (targetEnv) {
    if (!isLoopback(targetEnv.NUXT_PUBLIC_SUPABASE_URL)) problems.push(`the target Supabase URL must be local (got ${JSON.stringify(targetEnv.NUXT_PUBLIC_SUPABASE_URL)})`)
    if (target === 'recovery') {
      if (targetEnv.AAWRAQ_STACK !== 'recovery') problems.push('the recovery environment file must declare AAWRAQ_STACK=recovery (it is the isolated stack, created by scripts/recovery/recovery-stack.ps1)')
      if (devEnv && targetEnv.NUXT_PUBLIC_SUPABASE_URL === devEnv.NUXT_PUBLIC_SUPABASE_URL) problems.push('the recovery URL equals the dev URL: they must be different stacks')
    }
    if (target === 'dev' && targetEnv.AAWRAQ_STACK === 'recovery') problems.push('the dev environment file points at the recovery stack')
  } else problems.push('no environment file for the chosen target')
  return { ok: problems.length === 0, problems }
}

/** The recovery stack must contain NO synthetic data; this is checked on the live database before any real write. */
export function checkRecoveryStackIsClean({ demoBooks, demoProvenanceBooks, testUsers, demoCategories, demoMakers }) {
  const problems = []
  if (demoBooks) problems.push(`${demoBooks} demo books (is_demo)`)
  if (demoProvenanceBooks) problems.push(`${demoProvenanceBooks} books with provenance 'demo'`)
  if (testUsers) problems.push(`${testUsers} test users (@aawraq.test)`)
  if (demoCategories) problems.push(`${demoCategories} demo categories`)
  if (demoMakers) problems.push(`${demoMakers} demo makers`)
  return { ok: problems.length === 0, problems }
}

export function loadTargetEnv(target, root = ROOT) {
  const file = path.join(root, target === 'recovery' ? '.env.recovery' : '.env')
  return { file, env: existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : null, devEnv: existsSync(path.join(root, '.env')) ? parseEnv(readFileSync(path.join(root, '.env'), 'utf8')) : null }
}

export async function countSynthetic(db) {
  const head = { count: 'exact', head: true }
  const n = async (q) => (await q).count ?? 0
  const users = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  return {
    demoBooks: await n(db.from('books').select('id', head).eq('is_demo', true)),
    demoProvenanceBooks: await n(db.from('books').select('id', head).eq('provenance', 'demo')),
    demoCategories: await n(db.from('categories').select('id', head).eq('is_demo', true)),
    demoMakers: await n(db.from('makers').select('id', head).eq('is_demo', true)),
    testUsers: (users.data?.users ?? []).filter((u) => /@aawraq\.test$/i.test(u.email ?? '')).length,
  }
}
