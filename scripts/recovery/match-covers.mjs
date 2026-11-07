// Matches recovered ORIGINAL cover files (the legacy product_cover folder, once copied to this PC) to the hosted books, by evidence. READ-ONLY: it opens no database write
// and uploads nothing; apply-original-covers.mjs acts on its report afterwards.
//   node scripts/recovery/match-covers.mjs --covers D:\mostqel\aawraq-vps-content\product_cover [--visual] [--pages D:\mostqel\aawraq-generated-covers] [--out <dir>]
//
// Every cover file is validated first (a regular file, not a link, an image by its first bytes and not by its name, a sane size and dimensions, hashed); anything else is
// rejected and reported, never matched. The matching rules are in shared/utils/coverMatching.ts (unit-tested): verified (documented same-request timestamps), candidate_strong
// (visually the book's own first page), candidate (adjacent timestamp), unmatched. A similar title is never evidence, and one image is never given to two books.
// --visual also fingerprints each cover and each book's generated first page with a perceptual hash (Chrome decodes the images) so a cover that IS the book's page 1 is found.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertAuthorizedSupabaseTarget } from '../../shared/utils/supabaseTarget.ts'
import { readImageInfo } from '../../shared/utils/imageInfo.ts'
import { matchCovers } from '../../shared/utils/coverMatching.ts'
import { OUT_DIR, ROOT } from '../migration/lib/paths.mjs'
import { loadEnv } from '../migration/lib/supabase.mjs'
import { dhashFiles } from './lib/dhash.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const coversDir = opt('--covers')
if (!coversDir || !existsSync(coversDir)) { console.error('usage: match-covers.mjs --covers <folder with the copied product_cover files> [--visual] [--pages <generated covers folder>] [--out <dir>]'); process.exit(2) }
if (path.resolve(coversDir).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase())) { console.error('refusing: keep recovered files outside the repository'); process.exit(2) }
const pagesDir = opt('--pages', 'D:\\mostqel\\aawraq-generated-covers')
const outDir = opt('--out', OUT_DIR)
const MAX_BYTES = 2 * 1024 * 1024 // the legacy cover limit, and the limit the admin upload applies today

// ---- validate the cover files --------------------------------------------------------------------------------------------------------------------------------
const covers = []
const rejected = []
for (const rel of (await readdir(coversDir, { recursive: true })).sort()) {
  const full = path.join(coversDir, rel)
  const st = await lstat(full)
  if (st.isDirectory()) continue
  const name = rel.replace(/\\/g, '/')
  if (st.isSymbolicLink() || !st.isFile()) { rejected.push({ file: name, reason: 'not a regular file' }); continue }
  if (st.size > MAX_BYTES || st.size < 200) { rejected.push({ file: name, reason: `size ${st.size} bytes is outside the accepted range` }); continue }
  const bytes = await readFile(full)
  const info = readImageInfo(bytes)
  if (!info || !['webp', 'jpeg', 'png'].includes(info.type)) { rejected.push({ file: name, reason: 'its first bytes are not a JPEG, PNG or WebP image (the extension proves nothing)' }); continue }
  if (!info.width || !info.height || info.width < 100 || info.height < 100 || info.width > 6000 || info.height > 6000) { rejected.push({ file: name, reason: `implausible dimensions ${info.width}x${info.height}` }); continue }
  covers.push({ file: name.startsWith('product_cover/') ? name : `product_cover/${name.split('/').pop()}`, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: st.size, type: info.type, width: info.width, height: info.height, _path: full })
}

// ---- the books (read-only) -------------------------------------------------------------------------------------------------------------------------------------
const env = loadEnv(path.join(ROOT, '.env.hosted'))
assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL)
if (!/^https:\/\/ubjuyeccioflhpcpnhmo\.supabase\.co\/?$/.test(env.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.hosted does not point at the authorised project'); process.exit(2) }
const db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const rows = async (table, cols) => { const all = []; for (let f = 0; ; f += 1000) { const { data, error } = await db.from(table).select(cols).order('id').range(f, f + 999); if (error) throw new Error(`${table}: ${error.message}`); all.push(...data); if (data.length < 1000) return all } }
const books = await rows('books', 'id,title,cover_path,recovery_evidence')
const media = await rows('book_media', 'id,book_id,sha256,legacy_path')
const mediaByBook = new Map(media.map((m) => [m.book_id, m]))
const refs = books.map((b) => ({ id: b.id, title: b.title, pdf_file: mediaByBook.get(b.id)?.legacy_path ?? null }))

// ---- optional perceptual evidence --------------------------------------------------------------------------------------------------------------------------------
let hashes
if (args.includes('--visual')) {
  const pageFile = (b) => { const sha = mediaByBook.get(b.id)?.sha256; return sha ? path.join(pagesDir, `${sha}.jpg`) : null }
  const pageList = books.map((b) => [b.id, pageFile(b)]).filter(([, f]) => f && existsSync(f))
  const coverMap = await dhashFiles(covers.map((c) => c._path), ROOT)
  const pageMap = await dhashFiles(pageList.map(([, f]) => f), ROOT)
  hashes = { covers: {}, pages: {} }
  for (const c of covers) { const h = coverMap.get(c._path); if (h) hashes.covers[c.sha256] = h }
  for (const [id, f] of pageList) { const h = pageMap.get(f); if (h) hashes.pages[id] = h }
}

const matches = matchCovers({ covers: covers.map(({ file, sha256, bytes }) => ({ file, sha256, bytes })), books: refs, hashes })
const by = (c) => matches.filter((m) => m.confidence === c).length
const matchedBooks = new Set(matches.filter((m) => m.book_id != null).map((m) => m.book_id))
const summary = {
  generated_at: new Date().toISOString(), cover_files_found: covers.length + rejected.length, accepted_images: covers.length, rejected_files: rejected.length,
  unique_images: new Set(covers.map((c) => c.sha256)).size,
  verified: by('verified'), candidate_strong: by('candidate_strong'), candidate: by('candidate'), unmatched: by('unmatched'),
  books_total: books.length, books_with_a_proposed_cover: matchedBooks.size, books_still_without_an_original: books.length - matchedBooks.size, visual_evidence_used: !!hashes,
}
await mkdir(outDir, { recursive: true })
const stamp = summary.generated_at.replace(/[:.]/g, '-')
const report = path.join(outDir, `cover-matches-${stamp}.json`)
await writeFile(report, JSON.stringify({ summary, rejected, matches: matches.map((m) => ({ ...m, book_pdf_sha256: m.book_id != null ? (mediaByBook.get(m.book_id)?.sha256 ?? null) : null, ...(covers.find((c) => c.sha256 === m.sha256) ? { type: covers.find((c) => c.sha256 === m.sha256).type, width: covers.find((c) => c.sha256 === m.sha256).width, height: covers.find((c) => c.sha256 === m.sha256).height, bytes: covers.find((c) => c.sha256 === m.sha256).bytes } : {}) })) }, null, 1))
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
await writeFile(path.join(outDir, `cover-matches-${stamp}.csv`), `\uFEFF${['cover_file,sha256,book_id,method,confidence,review_required,evidence'].concat(matches.map((m) => [m.cover_file, m.sha256, m.book_id ?? '', m.method ?? '', m.confidence, m.review_required, m.evidence.join(' | ')].map(q).join(','))).join('\n')}`)
console.log(JSON.stringify(summary, null, 1))
console.log('report:', path.basename(report))
