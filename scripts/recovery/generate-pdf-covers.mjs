// Renders the FIRST PAGE of each hosted recovered book's own PDF into a small JPEG, and judges whether that page is really a cover. READ-ONLY on every source:
//   node scripts/recovery/generate-pdf-covers.mjs --confirm ubjuyeccioflhpcpnhmo [--out D:\mostqel\aawraq-generated-covers] [--limit N]
// Nothing is uploaded and no row is written here (apply-generated-covers.mjs does that, separately, after this report is reviewed).
//
// Safety:
// * Only PDFs that pass the approved policy are opened: hash equals the hosted record, readable, not encrypted, no active content (the same reader as the import),
//   and NOT in the /Launch exclusion set. A file that fails any of these is skipped and reported, never rendered.
// * Rendering uses Poppler (pdftoppm, pdfinfo, pdfimages, pdftotext): a maintained renderer with no script engine and no network access, started WITHOUT a shell
//   (arguments are an array, so an odd file name cannot become a command), with a time limit, one page, a bounded output size, and an empty private work folder.
//   The PDF is never modified and nothing embedded in it is ever run or opened.
// * Output is a JPEG named by the PDF's SHA-256 in a folder outside the repository. Its provenance is "generated_from_pdf", never "original_cover".
//
// Is page 1 a cover? Measured, not guessed: the share of the page covered by embedded pictures (pdfimages), the number of letters on the page (pdftotext), and
// whether the render is blank. high = one big picture and almost no text; medium = probably a cover, unclear; low = a text page; blank = nothing.
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget.ts'
import { OUT_DIR, QUARANTINE, ROOT } from '../migration/lib/paths.mjs'
import { loadEnv } from '../migration/lib/supabase.mjs'
import { safeJoin } from './lib/evidence-collect.mjs'
import { analyzePdfFile } from './lib/pdf-evidence.mjs'
import { classifyFirstPage, parseImageList, parsePageSize, pgmStats, jpegSize } from './lib/cover-pages.mjs'

const run = promisify(execFile)
const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
if (opt('--confirm') !== AUTHORIZED_SUPABASE_REF) { console.error(`refusing: pass --confirm ${AUTHORIZED_SUPABASE_REF}`); process.exit(2) }
const outDir = opt('--out', 'D:\\mostqel\\aawraq-generated-covers')
const limit = Number(opt('--limit', Infinity))
if (path.resolve(outDir).toLowerCase().startsWith(path.resolve(ROOT).toLowerCase())) { console.error('refusing: the output folder must be outside the repository'); process.exit(2) }

const env = loadEnv(path.join(ROOT, '.env.hosted'))
assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL)
if (!/^https:\/\/ubjuyeccioflhpcpnhmo\.supabase\.co\/?$/.test(env.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.hosted does not point at the authorised project'); process.exit(2) }
const db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const quarantineRoot = path.join(QUARANTINE, 'user-files')
const launchIds = new Set(JSON.parse(readFileSync(path.join(OUT_DIR, 'launch-pdf-review.json'), 'utf8')).files.map((f) => f.id))

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const pages = async (table, cols) => { const rows = []; for (let f = 0; ; f += 1000) { const d = must(await db.from(table).select(cols).order('id').range(f, f + 999), table); rows.push(...d); if (d.length < 1000) return rows } }
const books = await pages('books', 'id,title,status,cover_path,provenance')
const media = await pages('book_media', 'id,book_id,sha256,legacy_path,byte_size')
const mediaByBook = new Map(media.map((m) => [m.book_id, m]))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const tool = (cmd, a, o = {}) => run(cmd, a, { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', ...o })

await mkdir(outDir, { recursive: true })
const work = await mkdtemp(path.join(os.tmpdir(), 'aawraq-cover-'))
const results = []
const skipped = []
try {
  for (const b of books.slice(0, limit)) {
    const m = mediaByBook.get(b.id)
    const why = []
    const full = m?.legacy_path ? safeJoin(quarantineRoot, m.legacy_path) : null
    if (!m || !full || !existsSync(full)) { skipped.push({ book_id: b.id, reason: 'the quarantined PDF is missing' }); continue }
    if (launchIds.has(m.sha256.slice(0, 12))) { skipped.push({ book_id: b.id, reason: 'in the /Launch exclusion set: never rendered' }); continue }
    const bytes = await readFile(full)
    if (sha256(bytes) !== m.sha256) why.push('file hash differs from the hosted record')
    const a = await analyzePdfFile(full, { mode: 'full' })
    if (!a.ok) why.push('not a readable PDF')
    else { if (a.encrypted) why.push('encrypted'); if (a.suspicious) why.push(`active content: ${a.suspicious_reasons.join(', ')}`) }
    if (why.length) { skipped.push({ book_id: b.id, reason: why.join('; ') }); continue }

    // The tools run on a private copy of the ALREADY HASH-VERIFIED bytes under an ASCII name: an Arabic file name breaks some Poppler builds, and the original stays untouched.
    const copy = path.join(work, `${m.sha256}.pdf`)
    await writeFile(copy, bytes)
    try {
      const info = (await tool('pdfinfo', ['-f', '1', '-l', '1', copy])).stdout
      const size = parsePageSize(info)
      if (!size || size.w < 50 || size.h < 50 || size.w * size.h > 30_000_000) { skipped.push({ book_id: b.id, reason: `implausible page size ${JSON.stringify(size)}` }); continue }
      const imgList = parseImageList((await tool('pdfimages', ['-list', '-f', '1', '-l', '1', copy])).stdout)
      const text = (await tool('pdftotext', ['-f', '1', '-l', '1', '-enc', 'UTF-8', copy, '-'])).stdout
      const letters = text.match(/\p{L}/gu)?.length ?? 0
      const tiny = path.join(work, `t-${b.id}`)
      await tool('pdftoppm', ['-f', '1', '-l', '1', '-gray', '-scale-to-x', '64', '-scale-to-y', '-1', '-singlefile', copy, tiny])
      const stats = pgmStats(await readFile(`${tiny}.pgm`))
      const base = path.join(outDir, m.sha256)
      await tool('pdftoppm', ['-f', '1', '-l', '1', '-jpeg', '-jpegopt', 'quality=82,optimize=y', '-scale-to-x', '480', '-scale-to-y', '-1', '-singlefile', copy, base])
      const jpeg = await readFile(`${base}.jpg`)
      const dims = jpegSize(jpeg)
      if (jpeg.length < 1000 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || !dims || jpeg.length > 400_000) { skipped.push({ book_id: b.id, reason: 'the rendered image failed validation' }); continue }
      const verdict = classifyFirstPage({ coverage: imgList.coverage(size), letters, blank: stats.blank, aspect: dims.h / dims.w })
      results.push({
        book_id: b.id, title: b.title, pdf_sha256: m.sha256, has_cover_now: !!b.cover_path, page_pts: size, image_count: imgList.images.length,
        image_coverage: Number(imgList.coverage(size).toFixed(3)), first_page_letters: letters, blank: stats.blank, luminance: { mean: Number(stats.mean.toFixed(1)), std: Number(stats.std.toFixed(1)) },
        class: verdict.class, confidence: verdict.confidence, reason: verdict.reason,
        jpeg: { file: `${m.sha256}.jpg`, sha256: sha256(jpeg), bytes: jpeg.length, width: dims.w, height: dims.h }, provenance: 'generated_from_pdf',
      })
    } catch (e) { skipped.push({ book_id: b.id, reason: `render failed: ${String(e.stderr || e.message).split('\n')[0].slice(0, 160)}` }) } finally { await rm(copy, { force: true }) }
  }
} finally { await rm(work, { recursive: true, force: true }) }

const by = (k) => results.reduce((x, r) => ((x[r[k]] = (x[r[k]] ?? 0) + 1), x), {})
const summary = {
  generated_at: new Date().toISOString(), books_considered: Math.min(books.length, limit), rendered: results.length, skipped: skipped.length,
  by_confidence: by('confidence'), by_class: by('class'), total_jpeg_bytes: results.reduce((s, r) => s + r.jpeg.bytes, 0), output_folder: outDir,
  poppler: 'pdftoppm/pdfinfo/pdfimages/pdftotext (no script engine, no network)',
}
const file = path.join(OUT_DIR, `generated-covers-${summary.generated_at.replace(/[:.]/g, '-')}.json`)
await writeFile(file, JSON.stringify({ summary, skipped, results }, null, 1))
console.log(JSON.stringify(summary, null, 1))
console.log('skipped:', JSON.stringify(skipped.slice(0, 5)), skipped.length > 5 ? `… +${skipped.length - 5}` : '')
console.log('report:', path.basename(file))
