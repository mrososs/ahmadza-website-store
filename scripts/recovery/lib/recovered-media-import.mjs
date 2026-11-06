// Evidence-based DRAFT books from recovered PDFs. Planning is pure (no database); applying is insert-only and idempotent.
// What a draft contains is exactly what the file itself proves: its metadata title (and author/pages/date as evidence), its SHA-256 and size.
// Price, category, maker, publication state and purchase history are unknown and are never filled in: price 0, kind paid, status draft,
// recovery_evidence.note says so. The database refuses to publish such a book until an owner verifies it and sets a real price.
import { linkMedia as defaultLinkMedia } from '../../migration/lib/link.mjs'

export const TITLE_MAX = 250
export const EVIDENCE_NOTE = 'price and original record unknown; admin review required'

const cleanTitle = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim()

/** The books row for one recovered PDF. Only evidence from the file is used. */
export function buildBookRow({ analysis, staging, isDemo = false }) {
  const title = cleanTitle(analysis.title)
  return {
    title,
    kind: 'paid',
    status: 'draft',
    price_amount: 0,
    legacy_cost_raw: null,
    provenance: 'recovered_media',
    is_demo: isDemo,
    recovery_evidence: {
      source: 'pdf_metadata',
      sha256: staging.sha256,
      byte_size: staging.byte_size,
      pdf: {
        title,
        author: analysis.info?.author || analysis.xmp?.creator || null,
        pages: analysis.pages?.estimate ?? null,
        created: analysis.created ?? null,
      },
      staging_id: staging.id,
      note: EVIDENCE_NOTE,
    },
  }
}

/** Whether a PDF's evidence allows a draft. Returns null when it does, otherwise the reason it is skipped. */
export function eligibilityProblem(analysis, staging) {
  if (!analysis) return 'no_evidence'
  if (!analysis.ok) return `unreadable:${analysis.reason}`
  if (analysis.suspicious) return `suspicious:${analysis.suspicious_reasons.join(',')}`
  if (analysis.encrypted) return 'encrypted'
  if (!analysis.title_quality?.clear) return 'no_clear_title'
  if (analysis.size !== Number(staging.byte_size)) return 'size_differs_from_staging'
  if (analysis.sha256 && analysis.sha256 !== staging.sha256) return 'sha256_differs_from_staging'
  return null
}

/**
 * @param {object} p
 * @param {object[]} p.staging legacy_media_staging rows
 * @param {Map<string, object>} p.evidence PDF analysis by legacy_path
 * @param {{ evidenceShas: Set<string>, mediaShas: Set<string> }} p.existing sha256 already imported / already attached to some book
 * @param {boolean} [p.assumeStaged] dry-run planning without a readable staging table: treats inventoried rows as staged and says so
 * @param {boolean} [p.isDemo]
 */
export function groupBySha(staging, { assumeStaged = false } = {}) {
  const groups = new Map()
  for (const s of staging) if (s.detected_type === 'pdf' && s.scope === 'product' && s.status !== 'rejected') groups.set(s.sha256, [...(groups.get(s.sha256) ?? []), s])
  return [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([sha, list]) => {
    list.sort((a, b) => (a.duplicate_of ? 1 : 0) - (b.duplicate_of ? 1 : 0) || (a.id ?? 0) - (b.id ?? 0) || a.legacy_path.localeCompare(b.legacy_path))
    const ready = list.filter((s) => s.status === 'staged' || (assumeStaged && s.status === 'inventoried'))
    return { sha, list, canonical: ready[0] ?? null }
  })
}

/** The files whose evidence the plan needs: the canonical file of every distinct blob that is ready (staged). */
export function evidenceRows(groups) {
  return groups.filter((g) => g.canonical).map((g) => ({ path: g.canonical.legacy_path, size: Number(g.canonical.byte_size), sha256: g.sha }))
}

export function planImport({ staging, evidence, existing, assumeStaged = false, isDemo = false, limit = Infinity }) {
  const plan = { create: [], skipped: [], assumed_staged: assumeStaged }
  for (const { sha, list, canonical } of groupBySha(staging, { assumeStaged })) {
    const skip = (reason, extra = {}) => plan.skipped.push({ sha256: sha, reason, ...extra })
    if (list.some((s) => s.status === 'linked' || s.book_media_id)) { skip('already_linked'); continue }
    if (!canonical) { skip('not_staged'); continue }
    if (existing.evidenceShas.has(sha)) { skip('already_imported'); continue }
    if (existing.mediaShas.has(sha)) { skip('media_already_attached_to_a_book'); continue }
    const analysis = evidence.get(canonical.legacy_path)
    const problem = eligibilityProblem(analysis, canonical)
    if (problem) { skip(problem.split(':')[0], { detail: problem.includes(':') ? problem.split(':')[1] : undefined }); continue }
    if (plan.create.length >= limit) { skip('over_limit'); continue }
    plan.create.push({
      sha256: sha, staging_id: canonical.id, legacy_path: canonical.legacy_path, duplicate_paths: list.length - 1,
      title: cleanTitle(analysis.title), book: buildBookRow({ analysis, staging: canonical, isDemo }),
    })
  }
  return plan
}

const IN_CHUNK = 100
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

/** What the target database already holds for these hashes: draft books created earlier, and media rows attached to any book. */
export async function loadExistingKeys(db, shas) {
  const evidenceShas = new Set()
  const mediaShas = new Set()
  for (const part of chunks([...shas], IN_CHUNK)) {
    const books = await db.from('books').select('recovery_evidence').eq('provenance', 'recovered_media').in('recovery_evidence->>sha256', part)
    if (books.error) throw books.error
    for (const b of books.data) evidenceShas.add(b.recovery_evidence?.sha256)
    const media = await db.from('book_media').select('sha256').in('sha256', part)
    if (media.error) throw media.error
    for (const m of media.data) mediaShas.add(m.sha256)
  }
  return { evidenceShas, mediaShas }
}

/**
 * Inserts the planned drafts. Insert-only: an existing book is never updated. A draft whose file cannot be attached is removed again, so a
 * book never exists without its media.
 */
export async function applyImport(db, plan, { linkMedia = defaultLinkMedia } = {}) {
  const report = { created: [], failed: [] }
  for (const item of plan.create) {
    let bookId = null
    try {
      const { data: book, error } = await db.from('books').insert(item.book).select('id').single()
      if (error) throw error
      bookId = book.id
      const linked = await linkMedia(db, [{ legacy_path: item.legacy_path, book_id: bookId, visibility: 'after_purchase', name: item.title, kind: 'file' }])
      if (linked.failed.length || !linked.linked.length) throw new Error(linked.failed[0]?.error ?? linked.skipped[0]?.reason ?? 'media was not linked')
      report.created.push({ sha256: item.sha256, book_id: bookId, book_media_id: linked.linked[0].book_media_id ?? null })
    } catch (e) {
      if (bookId != null) await db.from('books').delete().eq('id', bookId) // cascades to any book_media row; the book is ours and still a draft
      report.failed.push({ sha256: item.sha256, error: String(e.message ?? e).slice(0, 300) })
    }
  }
  return report
}

export function summarisePlan(plan) {
  const reasons = {}
  for (const s of plan.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1
  return { would_create: plan.create.length, skipped: plan.skipped.length, skipped_by_reason: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])), assumed_staged: plan.assumed_staged }
}
