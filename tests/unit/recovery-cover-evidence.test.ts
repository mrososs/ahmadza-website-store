import { describe, expect, it } from 'vitest'
import { decideCandidate, decideGeneratedCover, withCandidate, withCurrentCover } from '../../shared/utils/coverEvidence'

const SHA = 'a'.repeat(64)
const result = (over: Record<string, unknown> = {}) => ({ confidence: 'high', jpeg: { sha256: SHA, bytes: 60000, width: 480, height: 700 }, ...over })
const book = (over: Record<string, unknown> = {}) => ({ id: 1, cover_path: null, recovery_evidence: {}, ...over })

describe('decideGeneratedCover', () => {
  it('attaches a high-confidence cover to a book that has none', () => expect(decideGeneratedCover({ book: book(), result: result() })).toEqual({ action: 'attach', sha12: 'aaaaaaaaaaaa' }))
  it('only proposes a medium or low one (an administrator decides)', () => {
    expect(decideGeneratedCover({ book: book(), result: result({ confidence: 'medium' }) }).action).toBe('candidate')
    expect(decideGeneratedCover({ book: book(), result: result({ confidence: 'low' }) }).action).toBe('candidate')
  })
  it('never offers a blank page', () => expect(decideGeneratedCover({ book: book(), result: result({ confidence: 'none' }) }).action).toBe('skip'))
  it('never overwrites a cover that is not itself generated', () => {
    for (const cur of [{ provenance: 'original_cover' }, { provenance: 'admin_upload' }, null]) {
      const d = decideGeneratedCover({ book: book({ cover_path: 'books/1/x.jpg', recovery_evidence: { cover: { current: cur, candidates: [] } } }), result: result() })
      expect(d.action, JSON.stringify(cur)).toBe('skip')
    }
  })
  it('is idempotent: the same generated cover is not attached or proposed twice', () => {
    const attached = withCurrentCover({}, { provenance: 'generated_from_pdf', sha256: SHA })
    expect(decideGeneratedCover({ book: book({ cover_path: 'books/1/a.jpg', recovery_evidence: attached }), result: result() }).action).toBe('skip')
    const proposed = withCandidate({}, { id: 'aaaaaaaaaaaa', provenance: 'generated_from_pdf', sha256: SHA, status: 'pending' })
    expect(decideGeneratedCover({ book: book({ recovery_evidence: proposed }), result: result({ confidence: 'medium' }) }).action).toBe('skip')
  })
  it('a different generated image may replace an earlier generated one', () => {
    const attached = withCurrentCover({}, { provenance: 'generated_from_pdf', sha256: 'b'.repeat(64) })
    expect(decideGeneratedCover({ book: book({ cover_path: 'books/1/old.jpg', recovery_evidence: attached }), result: result() }).action).toBe('attach')
  })
})

describe('evidence helpers', () => {
  it('keep the rest of the evidence and track whether anything is pending', () => {
    const ev = withCandidate({ sha256: SHA, uncertain: { price: 'unknown' } }, { id: 'c1', status: 'pending' })
    expect(ev.uncertain).toEqual({ price: 'unknown' })
    expect(ev.cover.has_pending).toBe(true)
    expect(withCurrentCover(ev, { provenance: 'generated_from_pdf' }).cover.candidates).toHaveLength(1)
  })
  it('replace a candidate with the same id instead of duplicating it', () => {
    let ev = withCandidate({}, { id: 'c1', status: 'pending', reason: 'one' })
    ev = withCandidate(ev, { id: 'c1', status: 'pending', reason: 'two' })
    expect(ev.cover.candidates).toHaveLength(1)
    expect(ev.cover.candidates[0].reason).toBe('two')
  })
})

describe('decideCandidate (the administrator)', () => {
  const ev = () => withCandidate(withCandidate({}, { id: 'c1', provenance: 'generated_from_pdf', status: 'pending' }), { id: 'c2', provenance: 'original_cover', status: 'pending' })
  it('approving attaches that candidate and settles the other pending ones as superseded', () => {
    const r = decideCandidate(ev(), 'c1', 'approve', 'admin-1', '2026-11-07T00:00:00Z')
    expect(r.ok).toBe(true)
    expect(r.attach.id).toBe('c1')
    expect(r.evidence.cover.candidates.map((c: { id: string; status: string }) => [c.id, c.status])).toEqual([['c1', 'approved'], ['c2', 'superseded']])
    expect(r.evidence.cover.has_pending).toBe(false)
  })
  it('rejecting settles only that candidate and attaches nothing', () => {
    const r = decideCandidate(ev(), 'c2', 'reject', 'admin-1')
    expect(r.attach).toBeNull()
    expect(r.evidence.cover.candidates.map((c: { status: string }) => c.status)).toEqual(['pending', 'rejected'])
    expect(r.evidence.cover.has_pending).toBe(true)
  })
  it('refuses an unknown candidate, a settled one, and an unknown decision', () => {
    expect(decideCandidate(ev(), 'zzz', 'approve', 'a').ok).toBe(false)
    const done = decideCandidate(ev(), 'c1', 'reject', 'a').evidence
    expect(decideCandidate(done, 'c1', 'approve', 'a').ok).toBe(false)
    expect(decideCandidate(ev(), 'c1', 'publish', 'a').ok).toBe(false)
    expect(decideCandidate({}, 'c1', 'approve', 'a').ok).toBe(false)
  })
})
