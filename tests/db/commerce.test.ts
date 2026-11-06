import { afterAll, describe, expect, it } from 'vitest'
import { signedInClient, serviceClient } from '../helpers/supabase'
import { createTestUser, demoPaidBooks, setAllowTestPayments, tx } from '../helpers/commerce'

const admin = serviceClient()
const newPayment = (user: string, books: number[], extra: { affiliate?: string | null } = {}) =>
  admin.rpc('create_payment_for_cart', { p_user: user, p_book_ids: books, p_affiliate: (extra.affiliate ?? null) as string, p_provider: 'dev_simulator', p_mode: 'test' })

afterAll(() => setAllowTestPayments(true))

describe('fulfill_payment', () => {
  it('is idempotent: two calls -> one order, one entitlement, one commission', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser()
    const aff = await createTestUser({ affiliate: true })
    const { data: pay, error } = await newPayment(buyer.id, [book!.id], { affiliate: aff.id })
    expect(error).toBeNull()
    const p = pay as unknown as { id: string; amount: number; currency: string }
    expect(Number(p.amount)).toBe(book!.price) // priced by the database

    const a = await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: p.currency })
    const b = await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: p.currency })
    expect(a.error).toBeNull(); expect(b.error).toBeNull()
    expect(a.data).toBe(b.data)

    const orders = await admin.from('orders').select('id,mode,total_amount').eq('user_id', buyer.id)
    expect(orders.data).toHaveLength(1)
    expect(orders.data![0]!.mode).toBe('test')
    expect((await admin.from('entitlements').select('id,is_test').eq('user_id', buyer.id)).data).toEqual([expect.objectContaining({ is_test: true })])
    expect((await admin.from('affiliate_commissions').select('id').eq('affiliate_id', aff.id)).data).toHaveLength(1)
    expect((await admin.from('affiliate_ledger').select('id').eq('affiliate_id', aff.id)).data).toHaveLength(1)
  })

  it('rejects a verified amount or currency that differs from the stored payment', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser()
    const p = (await newPayment(buyer.id, [book!.id])).data as unknown as { id: string; amount: number; currency: string }
    const wrongAmount = await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount) - 1, p_currency: p.currency })
    expect(wrongAmount.error?.message).toMatch(/does not match/)
    const wrongCur = await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: 'EUR' })
    expect(wrongCur.error?.message).toMatch(/does not match/)
    expect((await admin.from('orders').select('id').eq('user_id', buyer.id)).data).toHaveLength(0)
    expect((await admin.from('entitlements').select('id').eq('user_id', buyer.id)).data).toHaveLength(0)
  })

  it('refuses test payments when allow_test_payments is off (create and fulfil)', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser()
    const p = (await newPayment(buyer.id, [book!.id])).data as unknown as { id: string; amount: number; currency: string }
    await setAllowTestPayments(false)
    try {
      expect((await newPayment((await createTestUser()).id, [book!.id])).error?.message).toMatch(/test payments are disabled/)
      const f = await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: p.currency })
      expect(f.error?.message).toMatch(/test payments are disabled/)
    } finally { await setAllowTestPayments(true) }
    expect((await admin.from('orders').select('id').eq('user_id', buyer.id)).data).toHaveLength(0)
  })

  it('simulator payments can never be live (CHECK constraint)', async () => {
    const buyer = await createTestUser()
    const { error } = await admin.from('payments').insert({
      user_id: buyer.id, provider: 'dev_simulator', amount: 5, currency: 'USD', mode: 'live', cart_snapshot: [],
    })
    expect(error).not.toBeNull()
  })
})

describe('create_payment_for_cart', () => {
  it('banned and under-review accounts cannot start a payment', async () => {
    const [book] = await demoPaidBooks(1)
    for (const status of ['banned', 'review'] as const) {
      const u = await createTestUser({ status })
      expect((await newPayment(u.id, [book!.id])).error?.message).toMatch(/not allowed to purchase/)
    }
  })

  it('rejects already-owned, free, draft and unknown books', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser()
    const p = (await newPayment(buyer.id, [book!.id])).data as unknown as { id: string; amount: number; currency: string }
    await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: p.currency })
    expect((await newPayment(buyer.id, [book!.id])).error?.message).toMatch(/already in the library/)

    const free = (await admin.from('books').select('id').eq('is_demo', true).eq('kind', 'free').eq('status', 'published').limit(1)).data![0]!
    const draft = (await admin.from('books').select('id').eq('is_demo', true).eq('status', 'draft').limit(1)).data![0]!
    const other = await createTestUser()
    for (const id of [free.id, draft.id, 99999999]) {
      expect((await newPayment(other.id, [id])).error?.message).toMatch(/unavailable, free or unpublished/)
    }
    expect((await newPayment(other.id, [])).error).not.toBeNull()
  })

  it('totals are summed in the database, ignoring duplicates in the id list', async () => {
    const books = await demoPaidBooks(2)
    const buyer = await createTestUser()
    const { data } = await newPayment(buyer.id, [books[0]!.id, books[1]!.id, books[0]!.id])
    const p = data as unknown as { amount: number }
    expect(Number(p.amount)).toBeCloseTo(books[0]!.price + books[1]!.price, 2)
  })
})

describe('immutability + Data API isolation', () => {
  it('orders and order_items are immutable', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser()
    const p = (await newPayment(buyer.id, [book!.id])).data as unknown as { id: string; amount: number; currency: string }
    const orderId = (await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: p.currency })).data as string

    expect((await admin.from('orders').update({ total_amount: 0.01 }).eq('id', orderId)).error?.message).toMatch(/immutable/)
    expect((await admin.from('orders').delete().eq('id', orderId)).error?.message).toMatch(/append-only/)
    expect((await admin.from('order_items').update({ unit_price: 0 }).eq('order_id', orderId)).error?.message).toMatch(/immutable/)
    expect((await admin.from('order_items').delete().eq('order_id', orderId)).error?.message).toMatch(/immutable/)
  })

  it('customers cannot write orders / entitlements / payments, nor read each other\'s rows', async () => {
    const [book] = await demoPaidBooks(1)
    const a = await createTestUser(); const b = await createTestUser()
    const p = (await newPayment(a.id, [book!.id])).data as unknown as { id: string; amount: number; currency: string }
    const orderId = (await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: p.currency })).data as string

    const A = (await signedInClient(a.email)).client
    const B = (await signedInClient(b.email)).client

    // owner can read
    expect((await A.from('orders').select('id').eq('id', orderId)).data).toHaveLength(1)
    expect((await A.from('entitlements').select('id')).data).toHaveLength(1)
    expect((await A.from('payments').select('id,status')).data).toHaveLength(1)
    // unrelated user sees nothing
    expect((await B.from('orders').select('id')).data).toHaveLength(0)
    expect((await B.from('order_items').select('id')).data).toHaveLength(0)
    expect((await B.from('entitlements').select('id')).data).toHaveLength(0)
    expect((await B.from('payments').select('id')).data).toHaveLength(0)

    // no writes through the Data API, even on own rows
    for (const c of [A, B]) {
      expect((await c.from('orders').insert({ user_id: a.id, mode: 'test', total_amount: 0, currency: 'USD' })).error).not.toBeNull()
      expect((await c.from('entitlements').insert({ user_id: b.id, book_id: book!.id })).error).not.toBeNull()
      expect((await c.from('payments').insert({ user_id: b.id, provider: 'dev_simulator', amount: 1, currency: 'USD', cart_snapshot: [] })).error).not.toBeNull()
    }
    await A.from('entitlements').delete().eq('user_id', a.id)
    expect((await admin.from('entitlements').select('id').eq('user_id', a.id)).data).toHaveLength(1)
    await A.from('orders').update({ status: 'refunded' }).eq('id', orderId)
    expect((await admin.from('orders').select('status').eq('id', orderId).single()).data!.status).toBe('paid')
    expect((await A.rpc('fulfill_payment' as never, { p_payment_id: p.id } as never)).error).not.toBeNull()
  })

  it('payments.raw_response / cart_snapshot are not selectable by authenticated', async () => {
    const u = await createTestUser()
    const C = (await signedInClient(u.email)).client
    expect((await C.from('payments').select('raw_response')).error?.code).toBe('42501')
    expect((await C.from('payments').select('cart_snapshot')).error?.code).toBe('42501')
    expect((await C.from('payments').select('id,status,amount')).error).toBeNull()
  })
})
