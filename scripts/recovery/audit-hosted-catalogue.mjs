/* eslint-disable no-irregular-whitespace, no-control-regex -- this audit inspects titles for control, bidi and invisible characters on purpose, and writes a BOM for Excel */
// INDEPENDENT, READ-ONLY audit of every recovered record in the hosted project. It does not trust the importer's own counts.
//   node scripts/recovery/audit-hosted-catalogue.mjs --confirm ubjuyeccioflhpcpnhmo [--out <dir>]
// Each hosted record is cross-checked against three things that do not share code with the importer:
//   1. the original archive inventory (migration-output/inventory.json: path, size and SHA-256 recorded when the archive was first listed),
//   2. the actual bytes in quarantine (hashed again, header checked, analysed again with the PDF evidence reader, title compared),
//   3. the other hosted records (duplicate titles, hashes, source paths).
// It writes migration-output/hosted-catalogue-audit-<time>.json and .csv (git-ignored: they name the recovered files) and prints a summary. It changes nothing: no row, no file.
// Vocabulary: a record is "file_evidence_verified" when its FILE is proven (hash, size, header, no active content, not excluded) and its title equals the title inside the file.
// That is never "fully verified": author, categories, price and publication state have no evidence at all, and the title comes from the file, not from a catalogue.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget.ts'
import { OUT_DIR, QUARANTINE, ROOT } from '../migration/lib/paths.mjs'
import { loadEnv } from '../migration/lib/supabase.mjs'
import { readJsonFile, safeJoin } from './lib/evidence-collect.mjs'
import { analyzePdfFile } from './lib/pdf-evidence.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
if (opt('--confirm') !== AUTHORIZED_SUPABASE_REF) { console.error(`refusing: pass --confirm ${AUTHORIZED_SUPABASE_REF}`); process.exit(2) }
const outDir = opt('--out', OUT_DIR)
const env = loadEnv(path.join(ROOT, '.env.hosted'))
assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL)
if (!/^https:\/\/ubjuyeccioflhpcpnhmo\.supabase\.co\/?$/.test(env.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.hosted does not point at the authorised project'); process.exit(2) }
const db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const quarantineRoot = path.join(QUARANTINE, 'user-files')

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
async function all(table, cols, order = 'id') {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const data = must(await db.from(table).select(cols).order(order).range(from, from + 999), `read ${table}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}
const sha256File = (file) => new Promise((resolve, reject) => { const h = createHash('sha256'); createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex'))) })
const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()

// ---- read everything -------------------------------------------------------------------------------------------------------------------------
const books = await all('books', 'id,title,slug,status,kind,price_amount,pages,provenance,is_demo,cover_path,deleted_at,recovery_evidence,created_at')
const media = await all('book_media', 'id,book_id,name,migration_status,storage_provider,storage_path,sha256,byte_size,legacy_path,visibility,is_external,external_url')
const makers = await all('book_makers', 'book_id,maker_id', 'book_id')
const cats = await all('book_categories', 'book_id,category_id', 'book_id')
const mediaByBook = new Map(); for (const m of media) mediaByBook.set(m.book_id, [...(mediaByBook.get(m.book_id) ?? []), m])
const countBy = (rows) => rows.reduce((m, r) => (m.set(r.book_id, (m.get(r.book_id) ?? 0) + 1), m), new Map())
const makerCount = countBy(makers), catCount = countBy(cats)

const inventory = new Map((await readJsonFile(path.join(OUT_DIR, 'inventory.json'))).map((r) => [r.path, r]))
const launch = JSON.parse(readFileSync(path.join(OUT_DIR, 'launch-pdf-review.json'), 'utf8'))
const launchIds = new Set(launch.files.map((f) => f.id))

// ---- duplicates across records -----------------------------------------------------------------------------------------------------------------
const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (k) m.set(k, [...(m.get(k) ?? []), r]) } return [...m.values()].filter((g) => g.length > 1) }
const titleGroups = group(books, (b) => norm(b.title))
const shaGroups = group(media, (m) => m.sha256)
const pathGroups = group(media, (m) => m.legacy_path)
const dupTitleOf = new Map(); for (const g of titleGroups) for (const b of g) dupTitleOf.set(b.id, g)

// ---- per record ------------------------------------------------------------------------------------------------------------------------------
const AR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g
const LETTER = /\p{L}/gu
const BIDI = /[‎‏‪-‮⁦-⁩]/
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/
const report = []
for (const b of books) {
  const ev = b.recovery_evidence ?? {}
  const ms = mediaByBook.get(b.id) ?? []
  const m = ms[0]
  const anomalies = []
  const info = []
  const flag = (cond, msg) => { if (cond) anomalies.push(msg) }

  // title text
  const t = b.title ?? ''
  const letters = t.match(LETTER)?.length ?? 0
  const arabic = t.match(AR)?.length ?? 0
  flag(!t.trim(), 'title is empty')
  flag(t !== t.trim(), 'title has leading/trailing whitespace')
  flag(t.includes('�'), 'title contains the replacement character (encoding damage)')
  flag(CONTROL.test(t), 'title contains control characters')
  if (t !== t.normalize('NFC')) info.push('title has combining marks in non-canonical order (renders identically; search treats it as different text)')
  flag(t.length > 300 || norm(t).length < 3, 'title length is implausible')
  if (BIDI.test(t)) info.push('title contains bidi control characters')
  if (/\s{2,}/.test(t)) info.push('title has repeated spaces')
  const arabicShare = letters ? arabic / letters : 0
  if (letters && arabicShare < 0.5) info.push(`title is mostly non-Arabic (${Math.round(arabicShare * 100)}% Arabic letters)`)

  // records and relations
  flag(ms.length !== 1, `expected one media row, found ${ms.length}`)
  flag(b.provenance !== 'recovered_media', `provenance is ${b.provenance}`)
  flag(b.is_demo, 'flagged as demo data')
  flag(b.deleted_at != null, 'record is deleted')
  const sha = m?.sha256 ?? null
  flag(!/^[0-9a-f]{64}$/.test(sha ?? ''), 'media SHA-256 missing or malformed')
  flag(ev.sha256 !== sha, 'evidence SHA-256 differs from the media row')

  // archive inventory (recorded when the archive was first listed)
  const inv = m?.legacy_path ? inventory.get(m.legacy_path) : null
  flag(!inv, 'source path is not in the archive inventory')
  if (inv) {
    flag(inv.sha256 !== sha, 'archive inventory SHA-256 differs')
    flag(Number(inv.size) !== Number(m.byte_size), 'archive inventory size differs')
    flag(!inv.accepted || !inv.extracted, 'archive inventory did not accept this file')
  }
  const originalName = ev.source_file?.original_name ?? null
  flag(!originalName || originalName !== path.posix.basename(m?.legacy_path ?? ''), 'original file name does not match the source path')

  // the bytes
  let fileState = 'missing'
  let analysis = null
  const full = m?.legacy_path ? safeJoin(quarantineRoot, m.legacy_path) : null
  if (full && existsSync(full)) {
    fileState = 'present'
    const size = statSync(full).size
    const actual = await sha256File(full)
    flag(actual !== sha, 'file bytes hash differently from the recorded SHA-256')
    flag(size !== Number(m.byte_size), 'file size differs from the recorded size')
    analysis = await analyzePdfFile(full, { mode: 'full' })
    flag(!analysis.ok, `file is not a readable PDF (${analysis.reason ?? 'unknown'})`)
    if (analysis.ok) {
      flag(analysis.encrypted, 'file is encrypted')
      flag(analysis.suspicious, `file has active content: ${analysis.suspicious_reasons.join(', ')}`)
      flag(norm(analysis.title) !== norm(b.title), 'the record title differs from the title inside the file')
      if (analysis.pages?.estimate && ev.pdf?.pages && analysis.pages.estimate !== ev.pdf.pages) info.push('page estimate differs from the recorded evidence')
    }
  } else anomalies.push('the quarantined file is missing')
  flag(sha && launchIds.has(sha.slice(0, 12)), 'this PDF is in the /Launch exclusion set')
  flag(!ev.checks || ev.checks.malware_scan !== 'clean' || ev.checks.hash_verified !== true, 'recovery evidence lacks a clean scan or hash check')

  // duplicates
  const dups = []
  const tg = dupTitleOf.get(b.id)
  if (tg) dups.push({ kind: 'same_title', other_ids: tg.filter((x) => x.id !== b.id).map((x) => x.id) })
  if (sha && shaGroups.find((g) => g[0].sha256 === sha)) dups.push({ kind: 'same_file_hash' })
  if (m?.legacy_path && pathGroups.find((g) => g[0].legacy_path === m.legacy_path)) dups.push({ kind: 'same_source_path' })

  // publication safety
  flag(b.status !== 'draft', `status is ${b.status}`)
  flag(Number(b.price_amount) > 0 && b.status === 'published', 'purchasable: published with a price')

  // completeness (what is NOT known)
  const completeness = {
    title: anomalies.some((a) => a.startsWith('title')) ? 'damaged' : (analysis?.ok && norm(analysis.title) === norm(b.title) ? 'from_file_unverified' : 'unconfirmed'),
    author: (makerCount.get(b.id) ?? 0) > 0 ? 'assigned' : 'missing',
    categories: (catCount.get(b.id) ?? 0) > 0 ? 'assigned' : 'missing',
    price: Number(b.price_amount) > 0 ? 'set' : 'missing',
    cover: b.cover_path ? 'present' : 'missing',
    pdf_in_storage: m && m.migration_status === 'available' ? 'available' : 'not_uploaded',
  }
  const actions = []
  if (completeness.title !== 'from_file_unverified') actions.push('check or correct the title')
  actions.push('confirm the title against the original record')
  if (completeness.author === 'missing') actions.push('assign an author')
  if (completeness.categories === 'missing') actions.push('assign categories')
  if (completeness.price === 'missing') actions.push('set the price (or mark free)')
  if (completeness.cover === 'missing') actions.push('attach a cover')
  if (completeness.pdf_in_storage !== 'available') actions.push('upload the verified PDF to private storage')
  if (dups.some((d) => d.kind === 'same_title')) actions.push('decide whether the same-title records are different editions')
  if (anomalies.length) actions.unshift('investigate the anomalies')

  report.push({
    id: b.id, title: b.title, source_file: originalName, source_path: m?.legacy_path ?? null, sha256: sha, byte_size: m?.byte_size ?? null,
    verification_status: anomalies.length ? 'attention' : 'file_evidence_verified', file_state: fileState, completeness,
    cover_available: completeness.cover === 'present', pdf_available: completeness.pdf_in_storage === 'available',
    pdf_pages: analysis?.pages?.estimate ?? null, pdf_created: analysis?.created ?? null, pdf_producer: analysis?.info?.producer ?? null,
    duplicate_warnings: dups, anomalies, notes: info, required_admin_actions: actions,
  })
}

// ---- same-title groups: different editions, or an accidental repeat? --------------------------------------------------------------------------
const byId = new Map(report.map((r) => [r.id, r]))
const titleGroupReport = titleGroups.map((g) => {
  const rows = g.map((b) => byId.get(b.id))
  const sameHash = new Set(rows.map((r) => r.sha256)).size < rows.length
  const samePages = new Set(rows.map((r) => r.pdf_pages)).size === 1
  const sameSize = new Set(rows.map((r) => r.byte_size)).size === 1
  return {
    title: norm(g[0].title), ids: g.map((b) => b.id), distinct_files: new Set(rows.map((r) => r.sha256)).size,
    pages: rows.map((r) => r.pdf_pages), sizes: rows.map((r) => r.byte_size), created: rows.map((r) => r.pdf_created),
    reading: sameHash ? 'ACCIDENTAL REPEAT: the same file is imported more than once' : (samePages && sameSize ? 'same pages and size but different bytes: probably a re-export of one edition' : 'different files with different page counts or sizes: plausibly different editions or volumes'),
    action: 'admin decides; nothing is merged or deleted',
  }
})

const count = (pred) => report.filter(pred).length
const summary = {
  generated_at: new Date().toISOString(), target: AUTHORIZED_SUPABASE_REF,
  total_books: books.length,
  by_status: books.reduce((m, b) => ((m[b.status] = (m[b.status] ?? 0) + 1), m), {}),
  by_provenance: books.reduce((m, b) => ((m[b.provenance] = (m[b.provenance] ?? 0) + 1), m), {}),
  media_rows: media.length,
  unique_titles: new Set(books.map((b) => norm(b.title))).size,
  duplicate_title_groups: titleGroups.length, books_in_duplicate_title_groups: titleGroups.reduce((s, g) => s + g.length, 0),
  duplicate_hash_groups: shaGroups.length, duplicate_source_path_groups: pathGroups.length,
  empty_or_malformed_titles: count((r) => r.anomalies.some((a) => a.startsWith('title is empty') || a.includes('replacement') || a.includes('control') || a.includes('implausible') || a.includes('whitespace'))),
  titles_with_noncanonical_mark_order: count((r) => r.notes.some((n) => n.includes('non-canonical'))),
  titles_with_bidi_controls: count((r) => r.notes.some((n) => n.includes('bidi'))),
  titles_mostly_non_arabic: count((r) => r.notes.some((n) => n.includes('non-Arabic'))),
  file_evidence_verified: count((r) => r.verification_status === 'file_evidence_verified'),
  needing_attention: count((r) => r.verification_status === 'attention'),
  files_present_in_quarantine: count((r) => r.file_state === 'present'),
  title_equals_title_inside_file: count((r) => r.completeness.title === 'from_file_unverified'),
  in_launch_exclusion_set: count((r) => r.anomalies.some((a) => a.includes('/Launch'))),
  missing_author: count((r) => r.completeness.author === 'missing'), missing_categories: count((r) => r.completeness.categories === 'missing'),
  missing_price: count((r) => r.completeness.price === 'missing'), missing_cover: count((r) => r.completeness.cover === 'missing'),
  pdf_not_in_hosted_storage: count((r) => r.completeness.pdf_in_storage !== 'available'),
  published: books.filter((b) => b.status === 'published').length,
  purchasable_published_with_price: books.filter((b) => b.status === 'published' && Number(b.price_amount) > 0).length,
  anomaly_kinds: report.flatMap((r) => r.anomalies).reduce((m, a) => ((m[a] = (m[a] ?? 0) + 1), m), {}),
}
await mkdir(outDir, { recursive: true })
const stamp = summary.generated_at.replace(/[:.]/g, '-')
await writeFile(path.join(outDir, `hosted-catalogue-audit-${stamp}.json`), JSON.stringify({ summary, same_title_groups: titleGroupReport, records: report }, null, 1))
const csv = [['id', 'title', 'source_file', 'sha256', 'verification_status', 'author', 'categories', 'price', 'cover', 'pdf_in_storage', 'duplicate_warnings', 'anomalies', 'required_admin_actions'].join(',')]
  .concat(report.map((r) => [r.id, r.title, r.source_file, r.sha256, r.verification_status, r.completeness.author, r.completeness.categories, r.completeness.price, r.completeness.cover, r.completeness.pdf_in_storage, r.duplicate_warnings.map((d) => d.kind).join('|'), r.anomalies.join('|'), r.required_admin_actions.join('|')].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))).join('\n')
await writeFile(path.join(outDir, `hosted-catalogue-audit-${stamp}.csv`), `﻿${csv}`)
console.log(JSON.stringify(summary, null, 1))
console.log(`same-title groups: ${titleGroupReport.length}`)
for (const g of titleGroupReport) console.log(` - ids ${g.ids.join(',')} | ${g.distinct_files} distinct file(s) | pages ${g.pages.join('/')} | ${g.reading}`)
