// Pure rules for recording where a book's cover came from. The record lives in books.recovery_evidence.cover, so it needs no schema change and travels with the book:
//   cover = {
//     current:    { provenance, method, confidence, bucket, path, sha256, bytes, width, height, source_pdf_sha256, applied_at, review } | null,
//     candidates: [ { id, provenance, method, confidence, class, reason, bucket, path, sha256, bytes, width, height, status: 'pending'|'approved'|'rejected', created_at, ... } ],
//     has_pending: boolean   // denormalised so the admin list can filter on it
//   }
// provenance is one of: 'original_cover' (a recovered file from the legacy storage), 'generated_from_pdf' (the first page of the book's own PDF),
// 'admin_upload'. Nothing here touches a file or a row: the caller applies the decision.

export const PROVENANCE = ['original_cover', 'generated_from_pdf', 'admin_upload']

/** What a generated cover result may do to a book. Never overwrites a cover that is not itself generated; idempotent; only "high" confidence attaches without a person. */
export function decideGeneratedCover({ book, result }) {
  const ev = book.recovery_evidence ?? {}
  const cur = ev.cover?.current ?? null
  const sha12 = result.jpeg.sha256.slice(0, 12)
  if (book.cover_path && (!cur || cur.provenance !== 'generated_from_pdf')) return { action: 'skip', reason: 'the book already has a cover that is not a generated one (never overwritten)' }
  if (cur?.provenance === 'generated_from_pdf' && cur.sha256 === result.jpeg.sha256) return { action: 'skip', reason: 'this generated cover is already attached' }
  if ((ev.cover?.candidates ?? []).some((c) => c.sha256 === result.jpeg.sha256 && c.provenance === 'generated_from_pdf')) return { action: 'skip', reason: 'this generated cover is already a candidate' }
  if (result.confidence === 'high') return { action: 'attach', sha12 }
  if (result.confidence === 'none') return { action: 'skip', reason: 'the first page is blank' }
  return { action: 'candidate', sha12 }
}

const refresh = (cover) => ({ ...cover, has_pending: (cover.candidates ?? []).some((c) => c.status === 'pending') })

export function withCurrentCover(evidence, info) {
  const cover = evidence?.cover ?? { current: null, candidates: [] }
  return { ...(evidence ?? {}), cover: refresh({ ...cover, current: info, candidates: cover.candidates ?? [] }) }
}

export function withCandidate(evidence, candidate) {
  const cover = evidence?.cover ?? { current: null, candidates: [] }
  const candidates = [...(cover.candidates ?? []).filter((c) => c.id !== candidate.id), candidate]
  return { ...(evidence ?? {}), cover: refresh({ ...cover, candidates }) }
}

/** An administrator's decision on one candidate. Approving makes it the current cover and settles every other pending candidate as superseded; rejecting settles only that one. */
export function decideCandidate(evidence, candidateId, decision, adminId, now = new Date().toISOString()) {
  const cover = evidence?.cover
  const cand = cover?.candidates?.find((c) => c.id === candidateId)
  if (!cand) return { ok: false, reason: 'no such candidate' }
  if (cand.status !== 'pending') return { ok: false, reason: `the candidate is already ${cand.status}` }
  if (decision === 'reject') {
    const candidates = cover.candidates.map((c) => (c.id === candidateId ? { ...c, status: 'rejected', decided_by: adminId, decided_at: now } : c))
    return { ok: true, evidence: { ...evidence, cover: refresh({ ...cover, candidates }) }, attach: null }
  }
  if (decision !== 'approve') return { ok: false, reason: 'unknown decision' }
  const candidates = cover.candidates.map((c) => (c.id === candidateId ? { ...c, status: 'approved', decided_by: adminId, decided_at: now } : c.status === 'pending' ? { ...c, status: 'superseded', decided_by: adminId, decided_at: now } : c))
  return { ok: true, attach: cand, evidence: { ...evidence, cover: refresh({ ...cover, candidates }) } }
}
