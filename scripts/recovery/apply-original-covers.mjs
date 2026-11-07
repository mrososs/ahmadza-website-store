// Applies the report of match-covers.mjs: recovered ORIGINAL covers go to the hosted project (or, with --target recovery, to the local mirror).   DEFAULT IS A DRY RUN.
//   node scripts/recovery/apply-original-covers.mjs --report migration-output/cover-matches-<time>.json --covers D:\mostqel\aawraq-vps-content\product_cover --confirm ubjuyeccioflhpcpnhmo [--apply]
//   node scripts/recovery/apply-original-covers.mjs ... --target recovery [--apply]
//
// * VERIFIED matches (documented same-request timestamps) become the book's cover: the image goes to the PUBLIC bucket `public-media` as books/<id>/<sha12>.<ext> (content-hashed key,
//   its own MIME type, one-year immutable cache), provenance "original_cover". A generated cover may be replaced by an original; an original or hand-uploaded cover never is.
// * candidate_strong and candidate matches are filed as PENDING candidates in the PRIVATE bucket: an administrator approves them. Unmatched images are never uploaded.
// * Every file is re-read and checked against the report (hash, type by its bytes, size) before upload. Books are found by their PDF's SHA-256 (ids differ between stacks).
// * It never touches a book's status, price or publication, and it never uploads a PDF. Idempotent: an already attached or proposed image is skipped.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget.ts'
import { decideOriginalCover } from '../../shared/utils/coverMatching.ts'
import { withCandidate, withCurrentCover } from '../../shared/utils/coverEvidence.ts'
import { readImageInfo } from '../../shared/utils/imageInfo.ts'
import { OUT_DIR, ROOT } from '../migration/lib/paths.mjs'
import { loadEnv } from '../migration/lib/supabase.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const TARGET = opt('--target', 'hosted')
if (TARGET !== 'hosted' && TARGET !== 'recovery') { console.error('refusing: --target must be hosted or recovery'); process.exit(2) }
if (TARGET === 'hosted' && opt('--confirm') !== AUTHORIZED_SUPABASE_REF) { console.error(`refusing: pass --confirm ${AUTHORIZED_SUPABASE_REF}`); process.exit(2) }
const APPLY = args.includes('--apply')
const reportFile = opt('--report')
const coversDir = opt('--covers')
if (!reportFile || !coversDir) { console.error('usage: apply-original-covers.mjs --report <cover-matches json> --covers <folder> [--target hosted|recovery] [--confirm <ref>] [--apply]'); process.exit(2) }
const { matches } = JSON.parse(readFileSync(reportFile, 'utf8'))

const env = loadEnv(path.join(ROOT, TARGET === 'hosted' ? '.env.hosted' : '.env.recovery'))
if (TARGET === 'hosted') {
  assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL)
  if (!/^https:\/\/ubjuyeccioflhpcpnhmo\.supabase\.co\/?$/.test(env.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.hosted does not point at the authorised project'); process.exit(2) }
} else if (!/^http:\/\/(127\.0\.0\.1|localhost):55321$/.test(env.NUXT_PUBLIC_SUPABASE_URL)) { console.error('refusing: .env.recovery does not point at the local recovery stack'); process.exit(2) }
const db = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const count = async (q) => (await q).count
const counts = async () => ({
  with_cover_path: await count(db.from('books').select('id', { count: 'exact', head: true }).not('cover_path', 'is', null)),
  original_covers: await count(db.from('books').select('id', { count: 'exact', head: true }).eq('recovery_evidence->cover->current->>provenance', 'original_cover')),
  generated_covers: await count(db.from('books').select('id', { count: 'exact', head: true }).eq('recovery_evidence->cover->current->>provenance', 'generated_from_pdf')),
  with_pending_candidate: await count(db.from('books').select('id', { count: 'exact', head: true }).eq('recovery_evidence->cover->>has_pending', 'true')),
  published: await count(db.from('books').select('id', { count: 'exact', head: true }).eq('status', 'published')),
})
async function upload(bucket, key, bytes, mime, cache) {
  const up = await db.storage.from(bucket).upload(key, bytes, { contentType: mime, cacheControl: cache, upsert: false })
  if (!up.error) return
  if (/exist|duplicate/i.test(up.error.message)) { const dl = await db.storage.from(bucket).download(key); if (!dl.error && sha256(Buffer.from(await dl.data.arrayBuffer())) === sha256(bytes)) return }
  throw new Error(`upload to ${bucket}: ${up.error.message}`)
}

const before = await counts()
const out = { generated_at: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', target: TARGET === 'hosted' ? AUTHORIZED_SUPABASE_REF : 'recovery', report: path.basename(reportFile), before, attached: [], candidates: [], skipped: [], failed: [] }
for (const m of matches) {
  try {
    if (m.book_id == null || m.confidence === 'unmatched' || !m.book_pdf_sha256) { out.skipped.push({ cover: m.cover_file, reason: 'unmatched' }); continue }
    const owners = must(await db.from('book_media').select('book_id').eq('sha256', m.book_pdf_sha256), 'find the book by its PDF hash')
    if (owners.length !== 1 || owners[0].book_id == null) { out.skipped.push({ cover: m.cover_file, reason: `${owners.length} books own the matched PDF hash in the target` }); continue }
    const bookId = owners[0].book_id
    const book = must(await db.from('books').select('id,cover_path,status,recovery_evidence').eq('id', bookId).maybeSingle(), 'read book')
    const decision = decideOriginalCover(book, m)
    if (decision.action === 'skip') { out.skipped.push({ cover: m.cover_file, book_id: bookId, reason: decision.reason }); continue }
    const bytes = await readFile(path.join(coversDir, m.cover_file.replace(/^product_cover\//, '')))
    const info = readImageInfo(bytes)
    if (sha256(bytes) !== m.sha256 || !info || !['webp', 'jpeg', 'png'].includes(info.type) || bytes.length > 2 * 1024 * 1024) { out.failed.push({ cover: m.cover_file, error: 'the file differs from the report or fails validation' }); continue }
    const ext = info.type === 'jpeg' ? 'jpg' : info.type
    const sha12 = m.sha256.slice(0, 12)
    const base = { provenance: 'original_cover', method: m.method, confidence: m.confidence, sha256: m.sha256, bytes: bytes.length, width: info.width, height: info.height, source_file: m.cover_file, match_evidence: m.evidence }
    if (decision.action === 'attach') {
      const key = `books/${bookId}/${sha12}.${ext}`
      if (APPLY) {
        await upload('public-media', key, bytes, info.mime, '31536000')
        must(await db.from('books').update({ cover_path: key, recovery_evidence: withCurrentCover(book.recovery_evidence, { ...base, bucket: 'public-media', path: key, applied_at: new Date().toISOString(), review: 'unreviewed' }) }).eq('id', bookId).eq('status', 'draft'), 'attach cover')
      }
      out.attached.push({ book_id: bookId, path: key, confidence: m.confidence })
    } else {
      const key = `cover-candidates/${bookId}/${sha12}.${ext}`
      if (APPLY) {
        await upload('private-sensitive', key, bytes, info.mime, '3600')
        const cand = { id: sha12, ...base, class: m.confidence, reason: `${m.method}: ${m.evidence.join(' | ')}`.slice(0, 600), bucket: 'private-sensitive', path: key, status: 'pending', created_at: new Date().toISOString() }
        must(await db.from('books').update({ recovery_evidence: withCandidate(book.recovery_evidence, cand) }).eq('id', bookId).eq('status', 'draft'), 'record candidate')
      }
      out.candidates.push({ book_id: bookId, path: key, confidence: m.confidence })
    }
  } catch (e) { out.failed.push({ cover: m.cover_file, error: String(e.message).slice(0, 200) }) }
}
out.after = APPLY ? await counts() : null
const file = path.join(OUT_DIR, `original-covers-${APPLY ? 'apply' : 'dry-run'}-${out.generated_at.replace(/[:.]/g, '-')}.json`)
await writeFile(file, JSON.stringify(out, null, 1))
console.log(JSON.stringify({ mode: out.mode, target: out.target, would_or_did_attach: out.attached.length, would_or_did_propose: out.candidates.length, skipped: out.skipped.length, failed: out.failed.length, before, after: out.after, file: path.basename(file) }, null, 1))
if (out.failed.length) console.log('failed:', JSON.stringify(out.failed.slice(0, 5)))
process.exit(out.failed.length ? 1 : 0)
