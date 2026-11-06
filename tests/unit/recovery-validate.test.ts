import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs module without type declarations
import { looksMojibake, priceState, renderValidation, validateCatalog } from '../../scripts/recovery/lib/validate-catalog.mjs'

type Rows = Record<string, unknown>[]
const good = () => ({
  categories: [{ id: 1, name: 'روايات', status: 1 }, { id: 2, name: 'تاريخ', status: 1 }] as Rows,
  makers: [{ id: 1, name: 'مؤلف', type: 'author', status: 1 }, { id: 2, name: 'قارئ', type: 'reader', status: 1 }] as Rows,
  books: [
    { id: 1, name: 'كتاب أول', type: 'paid', cost: '12.50', status: 1, author_id: 1, category: '["1"]', created_at: '2022-03-04 10:00:00' },
    { id: 2, name: 'كتاب ثان', type: 'free', cost: null, status: 2, author_id: 2, category: '["1","2"]', created_at: '2023-01-02 00:00:00' },
  ] as Rows,
  book_media: [
    { id: 1, book_id: 1, file: 'product_media/a-0000000001.pdf', external: 0 },
    { id: 2, book_id: 2, file: 'https://example.invalid/x.pdf', external: 1 },
  ] as Rows,
  related_books: [{ book_id: 1, related_id: 2 }] as Rows,
})
const run = (tables: ReturnType<typeof good>, extra: Record<string, unknown> = {}) => validateCatalog({ tables, now: new Date('2026-11-06T00:00:00Z'), ...extra })
const codes = (r: { errors: { code: string }[]; warnings: { code: string }[] }) => ({ e: r.errors.map((x) => x.code), w: r.warnings.map((x) => x.code) })

describe('validateCatalog', () => {
  it('passes clean, consistent tables', () => {
    const r = run(good())
    expect(r.verdict).toBe('pass')
    expect(r.counts).toMatchObject({ books: 2, book_media: 2, categories: 2, makers: 2 })
  })

  it('fails when a required table is missing or books is empty, and when a required column is absent', () => {
    const t = good() as Record<string, Rows | undefined>
    delete t.book_media
    expect(codes(validateCatalog({ tables: t as never })).e).toContain('table_missing')
    expect(codes(run({ ...good(), books: [] })).e).toContain('table_empty')
    const noCost = { ...good(), books: [{ id: 1, name: 'x', type: 'free', status: 1 }] }
    expect(codes(run(noCost)).e).toContain('column_missing')
  })

  it('fails on duplicate or invalid primary keys', () => {
    const dup = good(); dup.books.push({ ...dup.books[0]! })
    expect(codes(run(dup)).e).toContain('pk_duplicate')
    const bad = good(); bad.categories.push({ id: 'abc', name: 'x', status: 1 })
    expect(codes(run(bad)).e).toContain('pk_invalid')
    const zero = good(); zero.makers.push({ id: 0, name: 'x', type: 'author', status: 1 })
    expect(codes(run(zero)).e).toContain('pk_invalid')
  })

  it('warns about orphans, unknown makers/categories and bad category JSON, but errors when most media is orphaned', () => {
    const t = good()
    t.book_media.push({ id: 3, book_id: 1, file: 'product_media/c.pdf', external: 0 }, { id: 4, book_id: 1, file: 'product_media/d.pdf', external: 0 }, { id: 5, book_id: 2, file: 'product_media/e.pdf', external: 0 })
    t.book_media.push({ id: 6, book_id: 99, file: 'product_media/b.pdf', external: 0 }) // 1 orphan in 6 rows: a warning, not an error
    t.books[0]!.author_id = 77
    t.books[1]!.category = '["1","55"]'
    t.books.push({ id: 3, name: 'ثالث', type: 'free', cost: null, status: 1, category: 'not-json' })
    t.related_books.push({ book_id: 1, related_id: 404 })
    const r = run(t)
    expect(r.verdict).toBe('pass_with_warnings')
    expect(codes(r).w).toEqual(expect.arrayContaining(['media_orphan_book', 'book_unknown_maker', 'book_unknown_category', 'book_category_json_invalid', 'related_unknown_book']))
    const mostlyOrphans = good(); mostlyOrphans.book_media = [1, 2, 3, 4].map((id) => ({ id, book_id: 900 + id, file: `product_media/${id}.pdf`, external: 0 }))
    expect(codes(run(mostlyOrphans)).e).toContain('media_orphan_book')
  })

  it('reports price, status, type and title problems without failing the run (they become drafts / rejects later)', () => {
    const t = good()
    t.books.push(
      { id: 3, name: 'بلا سعر', type: 'paid', cost: null, status: 1 },
      { id: 4, name: 'سعر تالف', type: 'paid', cost: 'abc', status: 1 },
      { id: 5, name: 'سعر صفر', type: 'paid', cost: '0', status: 1 },
      { id: 6, name: 'حالة غريبة', type: 'free', cost: null, status: 9 },
      { id: 7, name: 'نوع غريب', type: 'bundle', cost: '5', status: 1 },
      { id: 8, name: '   ', type: 'free', cost: null, status: 1 },
    )
    const r = run(t)
    expect(r.verdict).toBe('pass_with_warnings')
    expect(codes(r).w).toEqual(expect.arrayContaining(['paid_price_missing', 'paid_price_unparsable', 'paid_price_non_positive', 'book_unknown_status', 'book_unknown_type', 'book_empty_title']))
    expect(r.warnings.find((f: { code: string }) => f.code === 'paid_price_unparsable')?.sample_ids).toEqual([4])
  })

  it('flags unsafe media paths and external rows that are not URLs', () => {
    const t = good()
    t.book_media.push({ id: 3, book_id: 1, file: '../../etc/passwd', external: 0 }, { id: 4, book_id: 1, file: '/abs/x.pdf', external: 0 }, { id: 5, book_id: 1, file: 'C:\\x.pdf', external: 0 }, { id: 6, book_id: 1, file: null, external: 0 }, { id: 7, book_id: 1, file: 'ftp://x', external: 1 })
    const r = run(t)
    expect(r.warnings.find((f: { code: string }) => f.code === 'media_path_unsafe')?.sample_ids).toEqual([3, 4, 5, 6])
    expect(r.warnings.find((f: { code: string }) => f.code === 'media_external_not_url')?.sample_ids).toEqual([7])
  })

  it('detects character-set damage and fails when a large share of names is damaged', () => {
    expect(looksMojibake('Ø§Ù„ÙƒØªØ§Ø¨')).toBe(true)
    expect(looksMojibake('كتاب')).toBe(false)
    expect(looksMojibake('Hello world')).toBe(false)
    expect(looksMojibake('????')).toBe(true)
    expect(looksMojibake('bad \uFFFD char')).toBe(true)
    const some = good(); some.books.push({ id: 3, name: 'Ø§Ù„ÙƒØªØ§Ø¨', type: 'free', cost: null, status: 1 }, { id: 4, name: 'كتاب سليم', type: 'free', cost: null, status: 1 })
    for (let i = 5; i < 30; i++) some.books.push({ id: i, name: `كتاب ${i}`, type: 'free', cost: null, status: 1 })
    expect(codes(run(some)).w).toContain('text_mojibake')
    const most = good(); most.books = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: '????', type: 'free', cost: null, status: 1 }))
    expect(codes(run(most)).e).toContain('text_mojibake')
  })

  it('flags zero, future and implausibly old dates', () => {
    const t = good()
    t.books.push({ id: 3, name: 'أ', type: 'free', cost: null, status: 1, created_at: '0000-00-00 00:00:00' }, { id: 4, name: 'ب', type: 'free', cost: null, status: 1, created_at: '2031-01-01 00:00:00' }, { id: 5, name: 'ج', type: 'free', cost: null, status: 1, created_at: '1999-01-01 00:00:00' })
    const r = run(t)
    expect(codes(r).w).toEqual(expect.arrayContaining(['book_zero_or_invalid_date', 'book_future_date', 'book_implausibly_old_date']))
  })

  it('compares expected counts and matches media rows against an inventory of recovered files', () => {
    const r = run(good(), { expected: { books: 3 }, inventoryNames: ['x/y/a-0000000001.pdf', 'x/y/unused.pdf'] })
    expect(codes(r).w).toContain('count_differs_from_expected')
    expect(r.file_match).toEqual({ internal_media_rows: 1, rows_with_a_file_in_the_inventory: 1, rows_without_a_file: 0, inventory_files: 2, inventory_files_not_referenced_by_any_media_row: 1 })
    expect(codes(run(good(), { inventoryNames: ['other.pdf'] })).w).toContain('media_no_file_matches')
  })

  it('never puts row content (titles, names) into the findings or the rendered summary', () => {
    const t = good()
    t.books.push({ id: 3, name: 'عنوان سري جداً', type: 'paid', cost: 'abc', status: 1 }, { id: 4, name: 'Ø§Ù„ÙƒØªØ§Ø¨ السري', type: 'free', cost: null, status: 1 })
    const r = run(t)
    const text = JSON.stringify(r) + renderValidation(r)
    expect(text).not.toContain('عنوان سري')
    expect(text).not.toContain('السري')
    expect(text).not.toContain('روايات')
  })
})

describe('priceState', () => {
  it('classifies without converting', () => {
    expect(priceState('12.50')).toBe('ok')
    expect(priceState('١٢٫٥٠')).toBe('ok')
    expect(priceState('1,234.50')).toBe('ok')
    expect(priceState(null)).toBe('missing')
    expect(priceState('  ')).toBe('missing')
    expect(priceState('abc')).toBe('unparsable')
    expect(priceState('12 USD')).toBe('unparsable')
    expect(priceState('0')).toBe('non_positive')
    expect(priceState('0.00')).toBe('non_positive')
  })
})
