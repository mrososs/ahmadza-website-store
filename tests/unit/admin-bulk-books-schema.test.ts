import { describe, expect, it } from 'vitest'
import { adminBulkBooksSchema, BULK_BOOKS_MAX } from '../../shared/schemas/admin'

const ok = (v: unknown) => adminBulkBooksSchema.safeParse(v)

describe('adminBulkBooksSchema', () => {
  it('accepts the three operations', () => {
    expect(ok({ operation: 'make_free', ids: [1, 2] }).success).toBe(true)
    expect(ok({ operation: 'soft_delete', ids: [3] }).success).toBe(true)
    expect(ok({ operation: 'make_paid', ids: [1], price: 9.99 }).success).toBe(true)
  })
  it('rejects an unknown or missing operation', () => {
    expect(ok({ operation: 'hard_delete', ids: [1] }).success).toBe(false)
    expect(ok({ ids: [1] }).success).toBe(false)
    expect(ok(undefined).success).toBe(false)
  })
  it('rejects empty, oversized, duplicate and malformed id lists', () => {
    expect(ok({ operation: 'make_free', ids: [] }).success).toBe(false)
    expect(ok({ operation: 'make_free', ids: Array.from({ length: BULK_BOOKS_MAX + 1 }, (_, i) => i + 1) }).success).toBe(false)
    expect(ok({ operation: 'make_free', ids: Array.from({ length: BULK_BOOKS_MAX }, (_, i) => i + 1) }).success).toBe(true)
    expect(ok({ operation: 'make_free', ids: [1, 1] }).success).toBe(false)
    for (const bad of [0, -1, 1.5, '1', null, NaN]) expect(ok({ operation: 'make_free', ids: [bad] }).success).toBe(false)
  })
  it('requires a positive price with at most two decimals for make_paid', () => {
    for (const bad of [undefined, 0, -5, '9.99', null, NaN, Infinity, 100000.01, 1.005, 0.001]) expect(ok({ operation: 'make_paid', ids: [1], price: bad }).success).toBe(false)
    for (const good of [0.01, 1, 9.99, 19.5, 100000]) expect(ok({ operation: 'make_paid', ids: [1], price: good }).success).toBe(true)
  })
  it('does not carry a price into make_free / soft_delete', () => {
    const r = ok({ operation: 'make_free', ids: [1], price: 50 })
    expect(r.success && 'price' in r.data).toBe(false)
  })
})
