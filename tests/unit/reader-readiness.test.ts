import { describe, expect, it } from 'vitest'
import { assessReader, type ReadinessMedia } from '../../shared/utils/readerReadiness'

const m = (o: Partial<ReadinessMedia>): ReadinessMedia => ({ id: 1, extension: 'pdf', visibility: 'after_purchase', migration_status: 'available', page_count: 100, sha256: 'a'.repeat(64), ...o })

describe('reader readiness', () => {
  it('a missing price is never free: it is unclassified and blocks sale', () => {
    const r = assessReader({ kind: 'paid', status: 'draft', price_amount: null }, [m({})])
    expect(r.classification).toBe('unclassified'); expect(r.issues).toContain('price_missing')
    expect(assessReader({ kind: 'paid', status: 'draft', price_amount: 0 }, []).classification).toBe('unclassified')
  })
  it('free only when explicitly marked, and a free book with a price is flagged', () => {
    expect(assessReader({ kind: 'free', status: 'draft', price_amount: 0 }, [m({})]).issues).toEqual([])
    expect(assessReader({ kind: 'free', status: 'draft', price_amount: 5 }, [m({})]).issues).toContain('free_with_price')
  })
  it('reports PDF availability honestly', () => {
    expect(assessReader({ kind: 'paid', status: 'draft', price_amount: 9 }, []).issues).toContain('no_pdf')
    const r = assessReader({ kind: 'paid', status: 'draft', price_amount: 9 }, [m({ migration_status: 'pending' })])
    expect(r.issues).toContain('pdf_not_available'); expect(r.fullPdf).toEqual({ count: 1, available: 0 })
  })
  it('detects a public PDF that is the paid book itself (same hash, or as long)', () => {
    const paid = { kind: 'paid', status: 'draft', price_amount: 9 }
    expect(assessReader(paid, [m({}), m({ id: 2, visibility: 'preview' })]).publicFullPdf).toBe(true)
    expect(assessReader(paid, [m({}), m({ id: 2, visibility: 'preview', sha256: 'b'.repeat(64), page_count: 100 })]).publicFullPdf).toBe(true)
    expect(assessReader(paid, [m({}), m({ id: 2, visibility: 'preview', sha256: 'b'.repeat(64), page_count: 10 })]).publicFullPdf).toBe(false)
    expect(assessReader({ kind: 'free', status: 'draft', price_amount: 0 }, [m({}), m({ id: 2, visibility: 'preview' })]).publicFullPdf).toBe(false)
  })
})
