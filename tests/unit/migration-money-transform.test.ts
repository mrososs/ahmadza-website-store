import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs modules (no type declarations)
import { parseMoney, roundDecimal, sumDecimals, differsMoreThanHalfCent } from '../../scripts/migration/lib/money.mjs'
// @ts-expect-error plain .mjs modules
import * as T from '../../scripts/migration/lib/transform.mjs'
// @ts-expect-error plain .mjs fixture
import { legacyMock } from '../fixtures/legacy-mock.mjs'

describe('parseMoney (exact decimal strings, raw preserved)', () => {
  it('reads Arabic-Indic digits and the Arabic decimal separator', () => {
    expect(parseMoney('١٢٫٥٠')).toMatchObject({ ok: true, value: '12.50', raw: '١٢٫٥٠' })
  })
  it('accepts thousands separators only in an unambiguous pattern', () => {
    expect(parseMoney('1,234.50')).toMatchObject({ ok: true, value: '1234.50' })
    expect(parseMoney('12,5')).toMatchObject({ ok: false })
  })
  it('rejects text, empty, null, negatives and oversize values instead of coercing them', () => {
    for (const bad of ['abc', '', '  ', null, undefined, '-3', '1e5', '12.3.4', '123456789012']) expect(parseMoney(bad).ok).toBe(false)
    expect(parseMoney('-3', { allowNegative: true }).ok).toBe(true)
  })
  it('rounds float residue half-up on strings, never via floating point, and flags it', () => {
    expect(parseMoney('0.30000000000000004')).toMatchObject({ ok: true, value: '0.30', rounded: true })
    expect(roundDecimal('2.675', 2)).toBe('2.68')
    expect(roundDecimal('0.999', 2)).toBe('1.00')
    expect(roundDecimal('5', 2)).toBe('5.00')
  })
  it('sums exactly and detects differences larger than half a cent', () => {
    expect(sumDecimals(['0.10', '0.20'])).toBe('0.30')
    expect(differsMoreThanHalfCent('10.00', '10.004')).toBe(false)
    expect(differsMoreThanHalfCent('10.00', '10.01')).toBe(true)
  })
})

describe('status / enum maps', () => {
  it('keeps the ORIGINAL book status raw and imports every recovered book as a draft; an unknown status is kept raw with a reason', () => {
    const a = T.mapBook({ id: 1, name: 'x', type: 'free', status: 2 })
    expect(a.row).toMatchObject({ status: 'draft', legacy_status_raw: '2', provenance: 'legacy' })
    expect(a.legacyStatus).toBe('coming_soon')
    const b = T.mapBook({ id: 1, name: 'x', type: 'free', status: 7 })
    expect(b).toMatchObject({ ok: true, draftReasons: ['legacy_status_unknown'] })
    expect(b.row).toMatchObject({ status: 'draft', legacy_status_raw: '7' })
    expect(T.mapBook({ id: 1, name: 'x', type: 'free', status: null }).row.legacy_status_raw).toBeNull()
  })
  it('maps is_free 0 and 2 to preview, 1 to after_purchase', () => {
    expect(T.mapMediaVisibility(0)).toBe('preview')
    expect(T.mapMediaVisibility(2)).toBe('preview')
    expect(T.mapMediaVisibility('1')).toBe('after_purchase')
    expect(T.mapMediaVisibility(null)).toBeNull()
  })
  it('reads the 3-state withdraw column from the raw tinyint', () => {
    expect(T.WITHDRAW_STATUS).toEqual({ 2: 'pending', 1: 'paid', 0: 'rejected' })
    expect(T.mapWithdraw({ id: 1, affiliate_id: 1, amount: '5', status: 9 }).ok).toBe(false)
  })
})

describe('books', () => {
  const m = legacyMock()
  it('keeps the raw cost and parses Arabic-Indic prices', () => {
    const r = T.mapBook(m.books[0])
    expect(r.ok).toBe(true)
    expect(r.row).toMatchObject({ price_amount: 12.5, legacy_cost_raw: '١٢٫٥٠', kind: 'paid', status: 'draft', legacy_status_raw: '1', provenance: 'legacy' })
    expect(r.draftReasons).toEqual([])
    expect(r.categoryLegacyIds).toEqual([900001])
    expect(r.makers).toEqual([{ legacy_maker_id: 900001, role: 'author' }])
  })
  it('free book with NULL cost becomes 0.00; invalid category JSON is reported, never guessed', () => {
    const r = T.mapBook(m.books[1])
    expect(r.row).toMatchObject({ price_amount: 0, kind: 'free', status: 'draft', legacy_status_raw: '2', legacy_cost_raw: null })
    expect(r.legacyStatus).toBe('coming_soon')
    expect(r.categoryLegacyIds).toEqual([])
    expect(r.warnings.join()).toMatch(/category JSON invalid/)
  })
  it('a paid book with an unparsable / NULL / non-positive price is imported as a DRAFT at 0.00 with the raw string kept and an explicit reason (never rejected, never invented)', () => {
    const bad = T.mapBook(m.books[2])                         // cost 'abc'
    expect(bad).toMatchObject({ ok: true, draftReasons: ['price_unparsable'] })
    expect(bad.row).toMatchObject({ status: 'draft', price_amount: 0, legacy_cost_raw: 'abc', legacy_id: 900003 })
    const none = T.mapBook(m.books[3])                        // cost NULL
    expect(none).toMatchObject({ ok: true, draftReasons: ['price_missing'] })
    expect(none.row).toMatchObject({ status: 'draft', price_amount: 0, legacy_cost_raw: null })
    const zero = T.mapBook({ id: 5, name: 'x', type: 'paid', cost: '0', status: 1 })
    expect(zero).toMatchObject({ ok: true, draftReasons: ['price_non_positive'] })
    expect(zero.row).toMatchObject({ price_amount: 0, legacy_cost_raw: '0' })
    expect(bad.warnings.join()).toMatch(/imported as a draft at 0.00, raw string kept/)
  })
  it('a book with an unknown status keeps it raw and stays a draft', () => {
    const odd = T.mapBook(m.books[4])                         // status 7, valid cost
    expect(odd).toMatchObject({ ok: true, draftReasons: ['legacy_status_unknown'] })
    expect(odd.row).toMatchObject({ status: 'draft', legacy_status_raw: '7', price_amount: 5 })
  })
  it('only records that cannot be interpreted at all are rejected: unknown book type and empty title', () => {
    expect(T.mapBook(m.books[6])).toMatchObject({ ok: false })    // type 'bundle': free/paid cannot be guessed
    expect(T.mapBook(m.books[7])).toMatchObject({ ok: false })    // empty title
    expect(T.mapBook({ id: 9, name: 'x', type: 'free', status: 1 })).toMatchObject({ ok: true })
  })
  it('soft-deleted books are archived, not dropped', () => {
    const r = T.mapBook(m.books[5])
    expect(r.row.status).toBe('archived')
    expect(r.row.deleted_at).toBe('2024-05-05T00:00:00.000Z')
    expect(r.row.price_amount).toBe(1234.57)
  })
  it('sanitises HTML and rewrites editor images through the resolver', () => {
    const r = T.mapMaker(m.makers[0], {
      sanitize: (h: string) => h.replace(/<script>.*?<\/script>/g, ''),
      rewriteImages: (h: string) => T.rewriteEditorImages(h, (f: string) => (f === 'abc.png' ? '/media/abc.png' : null)),
    })
    expect(r.row.bio_html).not.toMatch(/script/)
    expect(r.row.bio_html).toMatch(/\/media\/abc\.png/)
    expect(T.rewriteEditorImages('<img src="http://x.invalid/public/uploads/editor/zzz.png">', () => null).unresolved).toEqual(['zzz.png'])
  })
})

describe('users: never copies credentials', () => {
  const m = legacyMock()
  it('drops password, default_password and tokens; flags reset; identifies affiliates by type', () => {
    const buyer = T.mapUser(m.users[0])
    const aff = T.mapUser(m.users[1])
    const serialised = JSON.stringify(buyer)
    expect(serialised).not.toMatch(/MOCKHASH|plain-mock-pass|"password"|default_password|remember_token/)
    expect(buyer.row).toMatchObject({ require_password_reset: true, is_affiliate: false, legacy_user_id: 900001 })
    expect(buyer.auth).toEqual({ email: 'buyer1@example.invalid', email_confirmed: true, create_login: true })
    expect(buyer.guestCreated).toBe(true)
    expect(aff.row.is_affiliate).toBe(true)
    expect(aff.legacyBalanceRaw).toBe('3.30000000000000004') // reported, never imported as a balance
  })
  it('PII columns only with the opt-in flag; null e-mail and odd status are rejected', () => {
    const base = { id: 1, status: 1, type: 0, name: 'x', email: 'a@b.invalid', phone: '123', country: 'X' }
    expect(T.mapUser(base).row.phone).toBeUndefined()
    expect(T.mapUser(base, { includePii: true }).row.phone).toBe('123')
    expect(T.mapUser(m.users[2]).ok).toBe(false)
    expect(T.mapUser(m.users[3]).ok).toBe(false)
  })
})

describe('orders & money history (verbatim)', () => {
  const m = legacyMock()
  it('keeps the raw amount next to the parsed one; test mode stays test; response is redacted', () => {
    const o = T.mapOrder(m.orders[0])
    expect(o.row).toMatchObject({ total_amount: '12.50', legacy_raw_amount: '12.50', mode: 'live', status: 'paid' })
    expect(JSON.stringify(o.row.legacy_response)).not.toMatch(/4111|zzz/)
    const t = T.mapOrder(m.orders[1])
    expect(t.row).toMatchObject({ total_amount: '7.00', legacy_raw_amount: '٧٫٠٠', mode: 'test' })
  })
  it('unparsable amounts are rejected for manual handling, never recomputed', () => {
    expect(T.mapOrder(m.orders[3])).toMatchObject({ ok: false })
  })
  it('order lines keep cost + raw and the internal deduction columns', () => {
    const i = T.mapOrderItem(m.order_contents[0])
    expect(i.row).toMatchObject({ unit_price: '12.50', legacy_raw_cost: '12.50', selling_fee: '0.9000', cart_fee: '0.2700' })
  })
  it('entitlements: paid, live, non-deleted orders only (test orders excluded by default)', () => {
    const orders = m.orders.map((o: any) => T.mapOrder(o)).filter((x: any) => x.ok).map((x: any) => ({ ...x.row, userLegacyId: x.userLegacyId }))
    const items = m.order_contents.map((o: any) => T.mapOrderItem(o)).filter((x: any) => x.ok).map((x: any) => ({ ...x.row, orderLegacyId: x.orderLegacyId, bookLegacyId: x.bookLegacyId }))
    expect(T.deriveEntitlements(orders, items)).toEqual([{ userLegacyId: 900001, bookLegacyId: 900001, is_test: false, legacy_order_id: 900001 }])
    expect(T.deriveEntitlements(orders, items, { grantTest: true })).toHaveLength(1) // same (user,book) collapses
  })
  it('affiliate commission and withdraw history keep raw values; negative withdraw rejected', () => {
    const a = T.mapAffiliateOrder(m.affiliate_orders[0], 'live')
    expect(a.row).toMatchObject({ gross_amount: '12.50', percent: '10.00', amount: '1.25', is_test: false })
    expect(a.row.legacy_raw).toMatchObject({ profit: '1.25' })
    expect(T.mapWithdraw(m.withdraws[0]).row.status).toBe('pending')
    expect(T.mapWithdraw(m.withdraws[1]).ok).toBe(false)
  })
})

describe('content', () => {
  const m = legacyMock()
  it('page slug collisions keep the live (highest id) row and suffix the others', () => {
    const rows = [T.mapPage(m.pages[0]).row, T.mapPage(m.pages[1]).row]
    const { rows: out, collisions } = T.resolvePageSlugs(rows)
    expect(collisions).toEqual([{ slug: 'terms-mock', legacy_ids: [900002, 900001] }])
    expect(out.find((r: any) => r.legacy_id === 900002).slug).toBe('terms-mock')
    expect(out.find((r: any) => r.legacy_id === 900001).slug).toBe('terms-mock-legacy-900001')
    expect(T.mapPage(m.pages[2]).ok).toBe(false)
  })
  it('site settings: numeric parse, legacy "live" payment mode is reported but not applied', () => {
    const s = T.mapSiteInfo(m.site_infos[0])
    expect(s.row).toMatchObject({ affiliate_commission_percent: 20, commission_freeze_days: 14, min_withdrawal_amount: 50.5 })
    expect(s.row).not.toHaveProperty('payment_mode')
    expect(s.warnings.join()).toMatch(/payment_mode/)
  })
})
