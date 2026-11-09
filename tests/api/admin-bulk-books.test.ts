// Bulk book administration (/api/admin/books/bulk). Runs against the dev server (TEST_APP_URL) + LOCAL Supabase only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiAs, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'
import { createTestUser, demoPaidBooks, setAllowTestPayments, tx } from '../helpers/commerce'

type Api = Awaited<ReturnType<typeof apiAs>>
let guest: Api, customer: Api, affiliate: Api, admin: Api, adminId = ''
const db = serviceClient()
const created: number[] = []
const BULK = '/api/admin/books/bulk'
const bulk = (json: unknown) => admin(BULK, { method: 'POST', json })

async function mkBook(over: Record<string, unknown> = {}) {
  const { data, error } = await db.from('books').insert({
    title: `اختبار جماعي ${Math.random().toString(36).slice(2, 8)}`, kind: 'paid', status: 'draft', price_amount: 12.5, pages: 77, description_html: '<p>وصف</p>', ...over,
  } as never).select('*').single()
  if (error) throw error
  created.push(data.id)
  return data
}
const row = async (id: number) => (await db.from('books').select('*').eq('id', id).single()).data!
const stable = (b: Record<string, unknown>) => { const { kind: _k, price_amount: _p, updated_at: _u, ...rest } = b; return rest }

beforeAll(async () => {
  guest = await apiAs(null); customer = await apiAs(DEV_USERS.customer); affiliate = await apiAs(DEV_USERS.affiliate); admin = await apiAs(DEV_USERS.admin)
  adminId = (await signedInClient(DEV_USERS.admin)).userId
})
afterAll(async () => {
  if (!created.length) return
  await db.from('audit_log').delete().eq('entity', 'books').in('entity_id', created.map(String))
  await db.from('books').delete().in('id', created)
})

describe('authorisation', () => {
  it('is closed to guests (401) and non-admins (403)', async () => {
    const init = { method: 'POST', json: { operation: 'make_free', ids: [1] } }
    expect((await guest(BULK, init)).status).toBe(401)
    expect((await customer(BULK, init)).status).toBe(403)
    expect((await affiliate(BULK, init)).status).toBe(403)
  })
  it('a rejected request changes nothing', async () => {
    const b = await mkBook()
    await customer(BULK, { method: 'POST', json: { operation: 'make_free', ids: [b.id] } })
    expect((await row(b.id)).kind).toBe('paid')
  })
})

describe('validation (400, nothing applied)', () => {
  it('rejects bad operation, empty / duplicate / invalid / oversized ids, bad prices', async () => {
    const b = await mkBook()
    const bad: unknown[] = [
      { operation: 'hard_delete', ids: [b.id] }, { operation: 'make_free', ids: [] }, { operation: 'make_free', ids: [b.id, b.id] },
      { operation: 'make_free', ids: [0] }, { operation: 'make_free', ids: ['x'] }, { operation: 'make_free', ids: Array.from({ length: 101 }, (_, i) => i + 1) },
      { operation: 'make_paid', ids: [b.id] }, { operation: 'make_paid', ids: [b.id], price: 0 }, { operation: 'make_paid', ids: [b.id], price: -3 },
      { operation: 'make_paid', ids: [b.id], price: '5' }, { operation: 'make_paid', ids: [b.id], price: 1.234 }, { operation: 'make_paid', ids: [b.id], price: 1e9 },
    ]
    for (const body of bad) expect((await bulk(body)).status, JSON.stringify(body).slice(0, 80)).toBe(400)
    const after = await row(b.id)
    expect([after.kind, Number(after.price_amount), after.deleted_at]).toEqual(['paid', 12.5, null])
  })
})

describe('make_free', () => {
  it('sets kind=free, price=0, keeps the publication status and every unrelated field', async () => {
    const pub = await mkBook({ status: 'published' }), draft = await mkBook({ status: 'draft' }), soon = await mkBook({ status: 'coming_soon' })
    const before = [await row(pub.id), await row(draft.id), await row(soon.id)]
    const res = await bulk({ operation: 'make_free', ids: [pub.id, draft.id, soon.id] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect([...body.updated].sort()).toEqual([pub.id, draft.id, soon.id].sort()); expect(body.skipped).toEqual([])
    for (const b of before) {
      const a = await row(b.id)
      expect([a.kind, Number(a.price_amount)]).toEqual(['free', 0])
      expect(stable(a)).toEqual(stable(b)) // status, title, slug, description, pages, deleted_at ... untouched
    }
  })
  it('reports books already free as unchanged', async () => {
    const f = await mkBook({ kind: 'free', price_amount: 0, status: 'published' })
    const body = await (await bulk({ operation: 'make_free', ids: [f.id] })).json()
    expect(body.updated).toEqual([]); expect(body.skipped).toEqual([{ id: f.id, reason: 'unchanged' }])
  })
})

describe('make_paid', () => {
  it('applies the entered price to every selected book, never publishing a draft', async () => {
    const a = await mkBook({ kind: 'free', price_amount: 0, status: 'draft' }), b = await mkBook({ kind: 'free', price_amount: 0, status: 'published' })
    const body = await (await bulk({ operation: 'make_paid', ids: [a.id, b.id], price: 19.99 })).json()
    expect([...body.updated].sort()).toEqual([a.id, b.id].sort())
    for (const [id, status] of [[a.id, 'draft'], [b.id, 'published']] as const) {
      const r = await row(id)
      expect([r.kind, Number(r.price_amount), r.status, r.price_currency]).toEqual(['paid', 19.99, status, 'USD'])
    }
  })
  it('a recovered draft converts but stays a draft; the DB guard still refuses to publish an incomplete recovered book', async () => {
    const rec = await mkBook({ kind: 'free', price_amount: 0, status: 'draft', provenance: 'recovered_media' })
    const body = await (await bulk({ operation: 'make_paid', ids: [rec.id], price: 5 })).json()
    expect(body.updated).toEqual([rec.id])
    expect((await row(rec.id)).status).toBe('draft')
    const { error } = await db.from('books').update({ status: 'published' }).eq('id', rec.id)
    expect(error?.message).toMatch(/book_not_eligible/)
  })
})

describe('soft delete', () => {
  it('sets deleted_at only: the record stays, nothing else changes, and restore still works', async () => {
    const b = await mkBook({ status: 'published' })
    const before = await row(b.id)
    const body = await (await bulk({ operation: 'soft_delete', ids: [b.id] })).json()
    expect(body.updated).toEqual([b.id])
    const after = await row(b.id)
    expect(after.deleted_at).not.toBeNull()
    expect([after.kind, Number(after.price_amount), after.status, after.title]).toEqual([before.kind, Number(before.price_amount), before.status, before.title])
    expect((await admin(`/api/admin/books/${b.id}/restore`, { method: 'POST' })).status).toBe(200)
    expect((await row(b.id)).deleted_at).toBeNull()
  })
  it('skips missing and already-deleted books without failing the batch', async () => {
    const live = await mkBook(), gone = await mkBook({ deleted_at: new Date().toISOString() })
    const body = await (await bulk({ operation: 'soft_delete', ids: [live.id, gone.id, 2_000_000_000] })).json()
    expect(body.updated).toEqual([live.id])
    expect(body.skipped).toEqual(expect.arrayContaining([{ id: gone.id, reason: 'already_deleted' }, { id: 2_000_000_000, reason: 'not_found' }]))
    // a deleted book is not repriced either
    const r = await (await bulk({ operation: 'make_free', ids: [gone.id] })).json()
    expect(r.skipped).toEqual([{ id: gone.id, reason: 'already_deleted' }]); expect((await row(gone.id)).kind).toBe('paid')
  })
})

describe('audit log', () => {
  it('writes one entry per changed book with the acting admin and old / new values; none for skipped books', async () => {
    const a = await mkBook(), b = await mkBook({ kind: 'free', price_amount: 0 })
    await bulk({ operation: 'make_free', ids: [a.id, b.id] })
    const { data } = await db.from('audit_log').select('action,actor_id,entity_id,diff').eq('action', 'bulk.make_free').in('entity_id', [String(a.id), String(b.id)])
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ actor_id: adminId, entity_id: String(a.id) })
    expect(data![0]!.diff).toMatchObject({ old: { kind: 'paid', price_amount: 12.5 }, new: { kind: 'free', price_amount: 0 }, bulk: true })
  })
})

describe('historical purchases', () => {
  afterAll(() => setAllowTestPayments(true))
  it('orders, order_items snapshot prices, payments and entitlements are identical after a bulk reprice / delete', async () => {
    await setAllowTestPayments(true)
    const [book] = await demoPaidBooks(1)
    const orig = await row(book!.id)
    const buyer = await createTestUser()
    const pay = (await db.rpc('create_payment_for_cart', { p_user: buyer.id, p_book_ids: [book!.id], p_affiliate: null as unknown as string, p_provider: 'dev_simulator', p_mode: 'test' })).data as unknown as { id: string; amount: number; currency: string }
    expect((await db.rpc('fulfill_payment', { p_payment_id: pay.id, p_provider_txn: tx(), p_amount: Number(pay.amount), p_currency: pay.currency })).error).toBeNull()
    const orders = (await db.from('orders').select('id').eq('user_id', buyer.id)).data!.map((o) => o.id)
    const snapshot = async () => ({
      orders: (await db.from('orders').select('*').eq('user_id', buyer.id)).data,
      items: (await db.from('order_items').select('*').in('order_id', orders)).data,
      entitlements: (await db.from('entitlements').select('*').eq('user_id', buyer.id)).data,
      payments: (await db.from('payments').select('*').eq('id', pay.id)).data,
      commissions: (await db.from('commissions').select('*').in('order_id', orders)).data,
    })
    const before = await snapshot()
    expect(before.items?.[0]?.unit_price).toBeDefined()
    try {
      expect((await (await bulk({ operation: 'make_paid', ids: [book!.id], price: 777.77 })).json()).updated).toEqual([book!.id])
      expect((await (await bulk({ operation: 'make_free', ids: [book!.id] })).json()).updated).toEqual([book!.id])
      expect((await (await bulk({ operation: 'soft_delete', ids: [book!.id] })).json()).updated).toEqual([book!.id])
      expect(await snapshot()).toEqual(before)
    } finally {
      await db.from('books').update({ kind: orig.kind, price_amount: orig.price_amount, deleted_at: null }).eq('id', book!.id)
    }
  })
})
