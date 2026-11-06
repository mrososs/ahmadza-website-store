// Validates the recovered catalogue tables in an ISOLATED local MariaDB before they are imported.
//   node scripts/recovery/validate-recovered-catalog.mjs [--inventory migration-output/inventory.json] [--expect books=N,book_media=N,categories=N,makers=N]
// Env (restored copy only, read-only account): LEGACY_DB_HOST(127.0.0.1) LEGACY_DB_PORT LEGACY_DB_NAME LEGACY_DB_USER LEGACY_DB_PASSWORD
// Exit code: 0 pass / pass_with_warnings, 1 fail, 2 could not run. The report holds counts and ids only (no titles, names or other row content).
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OUT_DIR } from '../migration/lib/paths.mjs'
import { createMariaDbSource } from '../migration/lib/source.mjs'
import { OPTIONAL_TABLES, REQUIRED_TABLES, renderValidation, validateCatalog } from './lib/validate-catalog.mjs'

const args = process.argv.slice(2)
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
if (!process.env.LEGACY_DB_HOST || !process.env.LEGACY_DB_NAME || !process.env.LEGACY_DB_USER) {
  console.error('Missing LEGACY_DB_HOST / LEGACY_DB_NAME / LEGACY_DB_USER (+ LEGACY_DB_PASSWORD): point them at the ISOLATED recovered MariaDB (127.0.0.1) with a read-only account.')
  process.exit(2)
}
const expected = Object.fromEntries((opt('--expect') ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)] }))
let inventoryNames = null
if (opt('--inventory')) {
  try { inventoryNames = JSON.parse(await readFile(opt('--inventory'), 'utf8')).map((r) => r.path ?? r.name).filter(Boolean) } catch (e) { console.error(`cannot read the inventory: ${e.message}`); process.exit(2) }
}

const source = await createMariaDbSource({ host: process.env.LEGACY_DB_HOST, port: Number(process.env.LEGACY_DB_PORT ?? 3306), user: process.env.LEGACY_DB_USER, password: process.env.LEGACY_DB_PASSWORD, database: process.env.LEGACY_DB_NAME })
try {
  const present = new Set(await source.tables())
  const tables = {}
  for (const t of [...REQUIRED_TABLES, ...OPTIONAL_TABLES]) if (present.has(t)) tables[t] = await source.rows(t)
  const result = validateCatalog({ tables, expected, inventoryNames })
  await mkdir(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `validation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  await writeFile(file, JSON.stringify({ ...result, checked_at: new Date().toISOString() }, null, 2))
  console.log(renderValidation(result))
  console.log(`\nreport: ${file}`)
  process.exitCode = result.verdict === 'fail' ? 1 : 0
} finally { await source.close?.() }
