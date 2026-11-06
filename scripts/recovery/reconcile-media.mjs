// Read-only reconciliation of the recovered media with the catalogue.
//   node scripts/recovery/reconcile-media.mjs [--quarantine <dir>] [--edges-only] [--no-db] [--limit N] [--out <dir>]
// Inputs: migration-output/inventory.json, the quarantine folder (bounded byte reads, never executed) and, when reachable, the LOCAL dev
// database (SELECT only). Output: migration-output/media-reconciliation.json + .md (git-ignored). It never writes to any database and never
// copies a PDF anywhere.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OUT_DIR, QUARANTINE } from '../migration/lib/paths.mjs'
import { serviceClient } from '../migration/lib/supabase.mjs'
import { collectPdfEvidence, readJsonFile } from './lib/evidence-collect.mjs'
import { buildReconciliation, renderReconciliationMd } from './lib/reconciliation.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const out = opt('--out', OUT_DIR)
const root = opt('--quarantine', path.join(QUARANTINE, 'user-files'))
const limit = Number(opt('--limit', Infinity))

const inventory = await readJsonFile(path.join(OUT_DIR, 'inventory.json'))
const pdfRows = inventory.filter((r) => r.scope === 'product' && r.detected_type === 'pdf' && r.accepted && r.extracted).slice(0, limit)

// ---- the staging table and the link counts (SELECT only) ---------------------------------------------------------------------------------
let staging = null
const links = { verified_links: null, recovered_media_drafts: null, checked: false }
if (!flag('--no-db')) {
  try {
    const { db } = serviceClient()
    const all = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('legacy_media_staging').select('id,legacy_path,sha256,status,scope,detected_type,duplicate_of,book_media_id,storage_path').order('id').range(from, from + 999)
      if (error) throw error
      all.push(...data)
      if (data.length < 1000) break
    }
    staging = all
    const paths = new Set(inventory.map((r) => r.path))
    const linked = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('book_media').select('legacy_path,legacy_book_media_id').not('legacy_book_media_id', 'is', null).range(from, from + 999)
      if (error) throw error
      linked.push(...data)
      if (data.length < 1000) break
    }
    links.verified_links = linked.filter((m) => paths.has(m.legacy_path)).length
    const drafts = await db.from('books').select('id', { count: 'exact', head: true }).eq('provenance', 'recovered_media')
    links.recovered_media_drafts = drafts.count ?? 0
    links.checked = true
  } catch (e) { console.error(`database not readable (${String(e.message ?? e).slice(0, 120)}): continuing from the inventory alone`) }
}

// ---- PDF evidence (bounded reads of untrusted bytes) -------------------------------------------------------------------------------------
const started = Date.now()
const evidence = await collectPdfEvidence(pdfRows, {
  root, mode: flag('--edges-only') ? 'edges' : undefined, concurrency: 4,
  onProgress: (n, total) => { if (n % 100 === 0 || n === total) console.error(`  analysed ${n}/${total} PDFs (${((Date.now() - started) / 1000).toFixed(0)} s)`) },
})

const report = buildReconciliation({ inventory, evidence, staging, links, mode: flag('--edges-only') ? 'edges' : 'full' })
await mkdir(out, { recursive: true })
await writeFile(path.join(out, 'media-reconciliation.json'), JSON.stringify(report, null, 2))
await writeFile(path.join(out, 'media-reconciliation.md'), renderReconciliationMd(report))
const s = report.sections
console.log(JSON.stringify({
  report: path.join(out, 'media-reconciliation.md'),
  pdf_files: s.d_unmatched_pdf_files.files, unique_blobs: s.d_unmatched_pdf_files.unique_blobs, duplicate_groups: s.d_unmatched_pdf_files.duplicate_groups,
  clear_title_blobs: s.b_partially_recovered_books.candidate_distinct_blobs, staged_and_importable_now: s.b_partially_recovered_books.staged_and_importable_now,
  suspicious_files: s.f_rejected_or_suspicious.pdf_suspicious_files, verified_relationships: s.c_verified_relationships.count,
  seconds: Math.round((Date.now() - started) / 1000),
}, null, 2))
