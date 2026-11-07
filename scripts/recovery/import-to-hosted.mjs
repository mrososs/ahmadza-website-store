// Imports the GENUINE recovered book drafts (the evidence drafts held in the isolated recovery stack) into the HOSTED AAWRAQ project as review-only records.
//   node scripts/recovery/import-to-hosted.mjs --confirm ubjuyeccioflhpcpnhmo            # dry run (default): checks everything, writes nothing
//   node scripts/recovery/import-to-hosted.mjs --confirm ubjuyeccioflhpcpnhmo --apply    # writes the missing records
//   options: --limit N (first N source records), --out <dir> (reports, default migration-output)
//
// What it does, and what it refuses to do:
// * SOURCE is the recovery stack (.env.recovery, local only). TARGET is .env.hosted and ONLY the authorised project; any other project is refused.
// * Every record is re-checked before it is written: the PDF in quarantine is hashed again (SHA-256 and size must equal the recorded values), the hash must be unique in
//   the set, the record must be a draft recovered_media book that is not demo data, must carry the evidence block with its explicit "uncertain" list, and must NOT be one
//   of the PDFs flagged for /Launch. A record that fails any check is not imported.
// * Records are DRAFTS: status draft, kind paid as an explicit placeholder, price 0 as a placeholder (the database refuses to publish it), no author, no category, no
//   cover. Nothing is inferred. The PDF bytes are NOT uploaded: the media row is `pending` with its intended storage path, so the book shows as "missing media" until a
//   verified upload; nothing can be downloaded.
// * Idempotent: a record whose SHA-256 already exists in hosted book_media is skipped. A failed media insert removes the book it belongs to (no orphans).
// * It never deletes or updates existing hosted rows other than its own compensation, never touches auth, and prints exact before/after counts.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget.ts'
import { OUT_DIR, QUARANTINE, ROOT } from '../migration/lib/paths.mjs'
import { loadEnv, localUrlOrThrow } from '../migration/lib/supabase.mjs'
import { safeJoin } from './lib/evidence-collect.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
if (opt('--confirm') !== AUTHORIZED_SUPABASE_REF) { console.error(`refusing: pass --confirm ${AUTHORIZED_SUPABASE_REF}`); process.exit(2) }
const APPLY = args.includes('--apply')
const limit = Number(opt('--limit', Infinity))
const outDir = opt('--out', OUT_DIR)
const quarantineRoot = path.join(QUARANTINE, 'user-files')

// ---- clients ------------------------------------------------------------------------------------------------------------------------------
const srcEnv = loadEnv(path.join(ROOT, '.env.recovery'))
const src = createClient(localUrlOrThrow(srcEnv.NUXT_PUBLIC_SUPABASE_URL), srcEnv.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const hostedFile = path.join(ROOT, '.env.hosted')
if (!existsSync(hostedFile)) { console.error('missing .env.hosted'); process.exit(2) }
const dstEnv = loadEnv(hostedFile)
assertAuthorizedSupabaseTarget(dstEnv.NUXT_PUBLIC_SUPABASE_URL)
if (!/^https:\/\/ubjuyeccioflhpcpnhmo\.supabase\.co\/?$/.test(dstEnv.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.hosted does not point at the authorised project'); process.exit(2) }
const dst = createClient(dstEnv.NUXT_PUBLIC_SUPABASE_URL, dstEnv.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r }
const sha256File = (file) => new Promise((resolve, reject) => { const h = createHash('sha256'); createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex'))) })
const count = async (db, table, f = (q) => q) => must(await f(db.from(table).select('id', { count: 'exact', head: true })), `count ${table}`).count

async function counts(db) {
  return {
    books_total: await count(db, 'books'),
    books_recovered_media: await count(db, 'books', (q) => q.eq('provenance', 'recovered_media')),
    books_published: await count(db, 'books', (q) => q.eq('status', 'published')),
    books_demo: await count(db, 'books', (q) => q.eq('is_demo', true)),
    book_media_total: await count(db, 'book_media'),
    auth_users_profiles: await count(db, 'profiles'),
  }
}

// ---- source -------------------------------------------------------------------------------------------------------------------------------
const books = must(await src.from('books').select('*').eq('provenance', 'recovered_media').eq('is_demo', false).is('deleted_at', null).order('id'), 'read source books').data.slice(0, limit)
const mediaRows = []
for (let i = 0; i < books.length; i += 100) mediaRows.push(...must(await src.from('book_media').select('*').in('book_id', books.slice(i, i + 100).map((b) => b.id)).order('id'), 'read source media').data)
const mediaByBook = new Map()
for (const m of mediaRows) mediaByBook.set(m.book_id, [...(mediaByBook.get(m.book_id) ?? []), m])

const launch = existsSync(path.join(OUT_DIR, 'launch-pdf-review.json')) ? JSON.parse(readFileSync(path.join(OUT_DIR, 'launch-pdf-review.json'), 'utf8')) : null
if (!launch) { console.error('refusing: migration-output/launch-pdf-review.json is missing; run scripts/recovery/review-launch-pdfs.mjs first so no /Launch file can be imported'); process.exit(2) }
const launchIds = new Set(launch.files.map((f) => f.id))

// ---- re-check every record ------------------------------------------------------------------------------------------------------------------
const seen = new Map()
const records = []
const rejected = []
for (const b of books) {
  const problems = []
  const ev = b.recovery_evidence ?? {}
  const media = mediaByBook.get(b.id) ?? []
  const m = media[0]
  if (media.length !== 1) problems.push(`expected exactly one media row, found ${media.length}`)
  if (b.status !== 'draft') problems.push(`status is ${b.status}`)
  if (!b.title?.trim()) problems.push('empty title')
  if (Number(b.price_amount) !== 0) problems.push('price is not the zero placeholder')
  if (!ev.uncertain || !ev.uncertain.price || !ev.uncertain.author || !ev.uncertain.categories) problems.push('missing the explicit uncertain list')
  const sha = m?.sha256
  if (!/^[0-9a-f]{64}$/.test(sha ?? '')) problems.push('media sha256 invalid')
  if (sha && ev.sha256 !== sha) problems.push('evidence sha256 differs from the media row')
  if (sha && seen.has(sha)) problems.push(`duplicate of source book ${seen.get(sha)}`)
  if (sha) seen.set(sha, b.id)
  if (sha && launchIds.has(sha.slice(0, 12))) problems.push('this PDF carries a /Launch action (excluded)')
  const full = ev.source_file?.legacy_path ? safeJoin(quarantineRoot, ev.source_file.legacy_path.replace(/^public\//, '')) ?? safeJoin(quarantineRoot, ev.source_file.legacy_path) : null
  let verified = false
  if (!full || !existsSync(full)) problems.push('the quarantined file is missing')
  else if (sha) {
    const actual = await sha256File(full)
    if (actual !== sha) problems.push('quarantined file hash differs from the recorded SHA-256')
    else verified = true
  }
  if (problems.length) rejected.push({ source_book_id: b.id, title: b.title, problems })
  else records.push({ b, m, ev, sha, verified })
}

// ---- target state -------------------------------------------------------------------------------------------------------------------------
const before = await counts(dst)
const existing = new Map()
for (let i = 0; i < records.length; i += 100) {
  const rows = must(await dst.from('book_media').select('id,book_id,sha256,migration_status,storage_path,checksum_verified_at').in('sha256', records.slice(i, i + 100).map((r) => r.sha)), 'read hosted media').data
  for (const r of rows) existing.set(r.sha256, r)
}
const toCreate = records.filter((r) => !existing.has(r.sha))
const report = { generated_at: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', target: AUTHORIZED_SUPABASE_REF, source_books: books.length, rejected_by_recheck: rejected.length, rejected, hashes_reverified_against_quarantine: records.filter((r) => r.verified).length, launch_overlap: 0, already_in_hosted: records.length - toCreate.length, to_create: toCreate.length, before, created: [], failed: [] }

// ---- write --------------------------------------------------------------------------------------------------------------------------------
if (APPLY) {
  // Repair ONLY rows this tool itself wrote in an earlier state (a path under books/recovered/ that was marked available although no file was ever uploaded).
  report.repaired = []
  for (const row of existing.values()) {
    if (row.migration_status === 'available' && row.checksum_verified_at == null && row.storage_path === `books/recovered/${row.sha256}.pdf`) {
      const up = await dst.from('book_media').update({ storage_provider: 'none', storage_path: null, migration_status: 'pending' }).eq('id', row.id).eq('storage_path', row.storage_path).eq('migration_status', 'available')
      if (up.error) report.failed.push({ sha256: row.sha256, step: 'repair', error: up.error.message })
      else report.repaired.push(row.sha256)
    }
  }
  for (const r of toCreate) {
    const { b, m, ev, sha } = r
    const evidence = { ...ev, hosted_import: { at: new Date().toISOString(), from: 'isolated recovery stack', source_book_id: b.id, tool: 'scripts/recovery/import-to-hosted.mjs', file_uploaded: false, intended_storage_path: `books/recovered/${sha}.pdf` } }
    const ins = await dst.from('books').insert({ title: b.title, kind: b.kind, status: 'draft', price_amount: 0, pages: b.pages, provenance: 'recovered_media', is_demo: false, recovery_evidence: evidence }).select('id').single()
    if (ins.error) { report.failed.push({ source_book_id: b.id, sha256: sha, step: 'book', error: ins.error.message }); continue }
    const bookId = ins.data.id
    const med = await dst.from('book_media').insert({
      book_id: bookId, kind: 'file', visibility: 'after_purchase', name: m.name, extension: 'pdf', page_count: m.page_count, sort_order: m.sort_order ?? 0, is_external: false,
      // No file exists in hosted yet, so the row must not point at one: provider `none`, no path, `pending` (the database treats a provider with a path as an available file).
      storage_provider: 'none', storage_path: null, mime_type: 'application/pdf', byte_size: m.byte_size, sha256: sha, legacy_path: m.legacy_path, migration_status: 'pending',
    }).select('id').single()
    if (med.error) {
      await dst.from('books').delete().eq('id', bookId).eq('provenance', 'recovered_media') // compensation: no orphan book
      report.failed.push({ source_book_id: b.id, sha256: sha, step: 'media', error: med.error.message })
      continue
    }
    report.created.push({ source_book_id: b.id, hosted_book_id: bookId, hosted_media_id: med.data.id, sha256: sha, title: b.title })
  }
}
report.after = APPLY ? await counts(dst) : null
report.delta = APPLY ? Object.fromEntries(Object.keys(before).map((k) => [k, report.after[k] - before[k]])) : null

await mkdir(outDir, { recursive: true })
const file = path.join(outDir, `hosted-import-${APPLY ? 'apply' : 'dry-run'}-${report.generated_at.replace(/[:.]/g, '-')}.json`)
await writeFile(file, JSON.stringify(report, null, 1))
console.log(JSON.stringify({ mode: report.mode, source_books: report.source_books, rejected_by_recheck: report.rejected_by_recheck, hashes_reverified: report.hashes_reverified_against_quarantine, already_in_hosted: report.already_in_hosted, to_create: report.to_create, created: report.created.length, repaired: report.repaired?.length ?? 0, failed: report.failed.length, before, after: report.after, delta: report.delta, report: path.basename(file) }, null, 1))
process.exit(report.failed.length ? 1 : 0)
