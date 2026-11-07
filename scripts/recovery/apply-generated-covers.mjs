// Applies the reviewed report of generate-pdf-covers.mjs to the HOSTED project.   DEFAULT IS A DRY RUN.
//   node scripts/recovery/apply-generated-covers.mjs --confirm ubjuyeccioflhpcpnhmo            # dry run: decides everything, writes nothing
//   node scripts/recovery/apply-generated-covers.mjs --confirm ubjuyeccioflhpcpnhmo --apply    # uploads and records
//   options: --report <file> (default: the newest generated-covers-*.json), --folder <jpeg folder>, --limit N
//
// What it does, per book (decisions come from lib/cover-evidence.mjs, which is unit-tested):
// * HIGH confidence (the first page is one big portrait picture with almost no text): the JPEG goes to the PUBLIC bucket `public-media` as books/<id>/<sha12>.jpg
//   (content-hashed key, image/jpeg, one-year immutable cache) and becomes books.cover_path. Provenance "generated_from_pdf", review "unreviewed".
// * MEDIUM / LOW: the JPEG goes to the PRIVATE bucket `private-sensitive` (cover-candidates/<id>/<sha12>.jpg) and is recorded as a PENDING candidate. Nothing public, nothing attached:
//   an administrator approves or rejects it.
// * It NEVER overwrites a cover that is not itself a generated one, never uploads a file whose bytes differ from the report, and never touches a book's status, price or publication.
// * Idempotent: an already attached or already proposed image is skipped. No PDF is uploaded, ever; only these small page images.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget.ts'
import { OUT_DIR, ROOT } from '../migration/lib/paths.mjs'
import { loadEnv } from '../migration/lib/supabase.mjs'
import { decideGeneratedCover, withCandidate, withCurrentCover } from '../../shared/utils/coverEvidence.ts'
import { jpegSize } from './lib/cover-pages.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
// The target is the HOSTED project (needs --confirm <ref>) or, with --target recovery, the isolated local recovery stack (the local mirror of the same genuine data).
const TARGET = opt('--target', 'hosted')
if (TARGET !== 'hosted' && TARGET !== 'recovery') { console.error('refusing: --target must be hosted or recovery'); process.exit(2) }
if (TARGET === 'hosted' && opt('--confirm') !== AUTHORIZED_SUPABASE_REF) { console.error(`refusing: pass --confirm ${AUTHORIZED_SUPABASE_REF}`); process.exit(2) }
const APPLY = args.includes('--apply')
const folder = opt('--folder', 'D:\\mostqel\\aawraq-generated-covers')
const limit = Number(opt('--limit', Infinity))
const reportFile = opt('--report', path.join(OUT_DIR, readdirSync(OUT_DIR).filter((f) => /^generated-covers-\d{4}-/.test(f)).sort().at(-1) ?? ''))
const { results } = JSON.parse(readFileSync(reportFile, 'utf8'))

const env = loadEnv(path.join(ROOT, TARGET === 'hosted' ? '.env.hosted' : '.env.recovery'))
if (TARGET === 'hosted') {
  assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL)
  if (!/^https:\/\/ubjuyeccioflhpcpnhmo\.supabase\.co\/?$/.test(env.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.hosted does not point at the authorised project'); process.exit(2) }
} else if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(env.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.recovery does not point at the local recovery stack'); process.exit(2) }
const db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function counts() {
  const head = async (q) => (await q).count
  return {
    books: await head(db.from('books').select('id', { count: 'exact', head: true })),
    with_cover_path: await head(db.from('books').select('id', { count: 'exact', head: true }).not('cover_path', 'is', null)),
    with_pending_candidate: await head(db.from('books').select('id', { count: 'exact', head: true }).eq('recovery_evidence->cover->>has_pending', 'true')),
    published: await head(db.from('books').select('id', { count: 'exact', head: true }).eq('status', 'published')),
  }
}
const before = await counts()
const out = { generated_at: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', target: TARGET === 'hosted' ? AUTHORIZED_SUPABASE_REF : 'recovery', report: path.basename(reportFile), before, attached: [], candidates: [], skipped: [], failed: [] }

async function upload(bucket, key, bytes, cache) {
  const up = await db.storage.from(bucket).upload(key, bytes, { contentType: 'image/jpeg', cacheControl: cache, upsert: false })
  if (!up.error) return 'uploaded'
  if (/exist|duplicate/i.test(up.error.message)) { // same content-hashed key: confirm the stored bytes are ours before trusting it
    const dl = await db.storage.from(bucket).download(key)
    if (!dl.error && sha256(Buffer.from(await dl.data.arrayBuffer())) === sha256(bytes)) return 'already_present'
  }
  throw new Error(`upload to ${bucket}: ${up.error.message}`)
}

for (const r of results.slice(0, limit)) {
  try {
    // the book is found by its PDF's SHA-256, not by an id (ids differ between hosted and the recovery stack); there must be exactly one
    const owners = must(await db.from('book_media').select('book_id').eq('sha256', r.pdf_sha256), 'find the book by its PDF hash')
    if (owners.length !== 1 || owners[0].book_id == null) { out.skipped.push({ book_id: r.book_id, reason: `${owners.length} books own this PDF hash in the target` }); continue }
    const bookId = owners[0].book_id
    const book = must(await db.from('books').select('id,cover_path,status,recovery_evidence').eq('id', bookId).maybeSingle(), 'read book')
    if (!book) { out.skipped.push({ book_id: r.book_id, reason: 'no such book' }); continue }
    const decision = decideGeneratedCover({ book, result: r })
    if (decision.action === 'skip') { out.skipped.push({ book_id: r.book_id, reason: decision.reason }); continue }
    const bytes = await readFile(path.join(folder, r.jpeg.file))
    const dims = jpegSize(bytes)
    if (sha256(bytes) !== r.jpeg.sha256 || !dims || bytes.length > 400_000 || bytes.length !== r.jpeg.bytes) { out.failed.push({ book_id: r.book_id, error: 'the image bytes differ from the report or fail validation' }); continue }
    const base = { provenance: 'generated_from_pdf', method: 'pdf_first_page', confidence: r.confidence, sha256: r.jpeg.sha256, bytes: bytes.length, width: dims.w, height: dims.h, source_pdf_sha256: r.pdf_sha256 }
    if (decision.action === 'attach') {
      const key = `books/${bookId}/${decision.sha12}.jpg`
      if (APPLY) {
        await upload('public-media', key, bytes, '31536000')
        const ev = withCurrentCover(book.recovery_evidence, { ...base, bucket: 'public-media', path: key, applied_at: new Date().toISOString(), review: 'unreviewed', reason: r.reason })
        must(await db.from('books').update({ cover_path: key, recovery_evidence: ev }).eq('id', bookId).eq('status', 'draft'), 'attach cover')
      }
      out.attached.push({ book_id: bookId, path: key, confidence: r.confidence })
    } else {
      const key = `cover-candidates/${bookId}/${decision.sha12}.jpg`
      if (APPLY) {
        await upload('private-sensitive', key, bytes, '3600')
        const cand = { id: decision.sha12, ...base, class: r.class, reason: r.reason, bucket: 'private-sensitive', path: key, status: 'pending', created_at: new Date().toISOString() }
        must(await db.from('books').update({ recovery_evidence: withCandidate(book.recovery_evidence, cand) }).eq('id', bookId).eq('status', 'draft'), 'record candidate')
      }
      out.candidates.push({ book_id: bookId, path: key, confidence: r.confidence, class: r.class })
    }
  } catch (e) { out.failed.push({ book_id: r.book_id, error: String(e.message).slice(0, 200) }) }
}
out.after = APPLY ? await counts() : null
const file = path.join(OUT_DIR, `generated-covers-${APPLY ? 'apply' : 'dry-run'}-${out.generated_at.replace(/[:.]/g, '-')}.json`)
await writeFile(file, JSON.stringify(out, null, 1))
console.log(JSON.stringify({ mode: out.mode, report: out.report, would_or_did_attach: out.attached.length, would_or_did_propose: out.candidates.length, skipped: out.skipped.length, failed: out.failed.length, before, after: out.after, file: path.basename(file) }, null, 1))
if (out.failed.length) console.log('failed:', JSON.stringify(out.failed.slice(0, 5)))
process.exit(out.failed.length ? 1 : 0)
