// Pure rules for recording where a book's cover came from. Used by the recovery scripts AND by the admin endpoint, so both apply the same tested decisions.
// The record lives in books.recovery_evidence.cover, so it needs no schema change and travels with the book:
//   cover = {
//     current:    { provenance, method, confidence, bucket, path, sha256, bytes, width, height, source_pdf_sha256, applied_at, review } | null,
//     candidates: [ { id, provenance, method, confidence, class, reason, bucket, path, sha256, bytes, width, height, status: 'pending'|'approved'|'rejected'|'superseded', created_at, ... } ],
//     has_pending: boolean   // denormalised so the admin list can filter on it
//   }
// provenance is one of: 'original_cover' (a recovered file from the legacy storage), 'generated_from_pdf' (the first page of the book's own PDF), 'admin_upload'.
// Nothing here touches a file or a row: the caller applies the decision. (Erasable TypeScript only, so Node can run it directly.)

export const COVER_PROVENANCE = ['original_cover', 'generated_from_pdf', 'admin_upload'] as const
export type CoverProvenance = (typeof COVER_PROVENANCE)[number]

export interface CoverInfo {
  provenance: CoverProvenance; method?: string; confidence?: string; bucket?: string; path?: string; sha256?: string; bytes?: number; width?: number; height?: number
  source_pdf_sha256?: string; applied_at?: string; review?: string; reason?: string; [k: string]: unknown
}
export interface CoverCandidate extends CoverInfo { id: string; status: 'pending' | 'approved' | 'rejected' | 'superseded'; created_at?: string; decided_by?: string; decided_at?: string; class?: string }
export interface CoverEvidence { current: CoverInfo | null; candidates: CoverCandidate[]; has_pending?: boolean }
type Evidence = Record<string, unknown> & { cover?: CoverEvidence }

export interface GeneratedResult { confidence: string; jpeg: { sha256: string; bytes: number; width?: number; height?: number } }
export type CoverDecision = { action: 'skip'; reason: string } | { action: 'attach' | 'candidate'; sha12: string }

/** What a generated cover result may do to a book. Never overwrites a cover that is not itself generated; idempotent; only "high" confidence attaches without a person. */
export function decideGeneratedCover({ book, result }: { book: { cover_path: string | null; recovery_evidence: Evidence | null }; result: GeneratedResult }): CoverDecision {
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

const refresh = (cover: CoverEvidence): CoverEvidence => ({ ...cover, has_pending: (cover.candidates ?? []).some((c) => c.status === 'pending') })

export function withCurrentCover(evidence: Evidence | null | undefined, info: CoverInfo): Evidence {
  const cover = evidence?.cover ?? { current: null, candidates: [] }
  return { ...(evidence ?? {}), cover: refresh({ ...cover, current: info, candidates: cover.candidates ?? [] }) }
}

export function withCandidate(evidence: Evidence | null | undefined, candidate: CoverCandidate): Evidence {
  const cover = evidence?.cover ?? { current: null, candidates: [] }
  const candidates = [...(cover.candidates ?? []).filter((c) => c.id !== candidate.id), candidate]
  return { ...(evidence ?? {}), cover: refresh({ ...cover, candidates }) }
}

export type CandidateDecision = { ok: false; reason: string } | { ok: true; evidence: Evidence; attach: CoverCandidate | null }

/** An administrator's decision on one candidate. Approving settles every other pending candidate as superseded and returns the candidate to attach; rejecting settles only that one. */
export function decideCandidate(evidence: Evidence | null | undefined, candidateId: string, decision: string, adminId: string, now: string = new Date().toISOString()): CandidateDecision {
  const cover = evidence?.cover
  const cand = cover?.candidates?.find((c) => c.id === candidateId)
  if (!cover || !cand) return { ok: false, reason: 'no such candidate' }
  if (cand.status !== 'pending') return { ok: false, reason: `the candidate is already ${cand.status}` }
  if (decision === 'reject') {
    const candidates = cover.candidates.map((c) => (c.id === candidateId ? { ...c, status: 'rejected' as const, decided_by: adminId, decided_at: now } : c))
    return { ok: true, evidence: { ...evidence, cover: refresh({ ...cover, candidates }) }, attach: null }
  }
  if (decision !== 'approve') return { ok: false, reason: 'unknown decision' }
  const candidates = cover.candidates.map((c) => (c.id === candidateId ? { ...c, status: 'approved' as const, decided_by: adminId, decided_at: now } : c.status === 'pending' ? { ...c, status: 'superseded' as const, decided_by: adminId, decided_at: now } : c))
  return { ok: true, attach: cand, evidence: { ...evidence, cover: refresh({ ...cover, candidates }) } }
}
