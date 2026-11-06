// Slice D money logic against the LOCAL Supabase stack (service client = trusted server; user clients = Data API).
// Isolation: ledger / orders are append-only by design, so tests use dedicated archived "[test-d]" books and assert on
// DELTAS of the shared dev affiliate; every withdrawal a test creates is decided (nothing is left pending).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEV_USERS, serviceClient, signedInClient, type Db } from '../helpers/supabase'

const svc: Db = serviceClient()
let affiliateId = ''
let buyerId = ''
let contributorId = ''
let customerId = ''
const bookIds: number[] = []
let settings = { pct: 10, freeze: 30, min: 100 }

async function userId(email: string) {
  const { data } = await svc.rpc('find_user_id_by_email', { p_email: email })
  if (!data) throw new Error(`missing dev user ${email} — run npm run dev:seed`)
  return data as string
}
async function balance(id: string) {
  const { data, error } = await svc.rpc('affiliate_balance', { p_affiliate: id })
  if (error) throw error
  const b = (data as { available: number; frozen: number; pending_withdrawal: number; paid_out: number }[])[0]!
  return { available: Number(b.available), frozen: Number(b.frozen), pending: Number(b.pending_withdrawal), paidOut: Number(b.paid_out) }
}
async function newTestBook(price = 20) {
  const { data, error } = await svc.from('books').insert({ title: `[test-d] ${randomUUID().slice(0, 8)}`, kind: 'paid', status: 'published', price_amount: price }).select('id').single()
  if (error) throw error
  bookIds.push(data.id)
  return data.id
}
async function buy(buyer: string, books: number[], affiliate: string | null) {
  const { data: pay, error } = await svc.rpc('create_payment_for_cart', { p_user: buyer, p_book_ids: books, p_affiliate: affiliate as string, p_provider: 'dev_simulator', p_mode: 'test' })
  if (error) throw error
  return pay as { id: string; amount: number; currency: string; affiliate_id: string | null }
}
const fulfill = (p: { id: string; amount: number; currency: string }, txn = `dev-${randomUUID()}`) =>
  svc.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: txn, p_amount: Number(p.amount), p_currency: p.currency })

beforeAll(async () => {
  affiliateId = await userId(DEV_USERS.affiliate)
  buyerId = await userId(DEV_USERS.customer2)
  customerId = await userId(DEV_USERS.customer)
  contributorId = await userId(DEV_USERS.contributor)
  const { data } = await svc.from('site_settings').select('affiliate_commission_percent,commission_freeze_days,min_withdrawal_amount,allow_test_payments').eq('id', 1).single()
  expect(data?.allow_test_payments).toBe(true) // local dev switch from seed.sql
  settings = { pct: Number(data!.affiliate_commission_percent), freeze: data!.commission_freeze_days, min: Number(data!.min_withdrawal_amount) }
})

afterAll(async () => {
  // order_items are immutable, so purchased test books cannot be deleted: archive them out of the catalog instead.
  if (bookIds.length) await svc.from('books').update({ status: 'archived' }).in('id', bookIds)
})

describe('commission accrual', () => {
  it('creates exactly one commission per order, idempotently, and freezes it', async () => {
    const before = await balance(affiliateId)
    const bookId = await newTestBook(20)
    const pay = await buy(buyerId, [bookId], affiliateId)
    expect(pay.affiliate_id).toBe(affiliateId)

    const r1 = await fulfill(pay)
    expect(r1.error).toBeNull()
    const r2 = await fulfill(pay) // replay: same order, no side effects
    expect(r2.error).toBeNull()
    expect(r2.data).toBe(r1.data)

    const { data: comms } = await svc.from('affiliate_commissions').select('amount,percent,available_at,is_test').eq('order_id', r1.data as string)
    expect(comms).toHaveLength(1)
    const expected = Math.round(20 * settings.pct) / 100
    expect(Number(comms![0]!.amount)).toBeCloseTo(expected, 2)
    expect(comms![0]!.is_test).toBe(true) // visibly marked test data
    const { data: ledger } = await svc.from('affiliate_ledger').select('amount,entry_type').eq('commission_id', (await svc.from('affiliate_commissions').select('id').eq('order_id', r1.data as string).single()).data!.id)
    expect(ledger).toHaveLength(1)

    const after = await balance(affiliateId)
    if (settings.freeze > 0) {
      expect(after.available).toBeCloseTo(before.available, 2) // freeze period honoured: not withdrawable yet
      expect(after.frozen).toBeCloseTo(before.frozen + expected, 2)
      expect(new Date(comms![0]!.available_at).getTime()).toBeGreaterThan(Date.now() + (settings.freeze - 1) * 86_400_000)
    }
  })

  it('refuses a mismatching verified amount and never double-counts an order for the same payment', async () => {
    const bookId = await newTestBook(15)
    const pay = await buy(buyerId, [bookId], affiliateId)
    const bad = await svc.rpc('fulfill_payment', { p_payment_id: pay.id, p_provider_txn: `dev-${randomUUID()}`, p_amount: Number(pay.amount) - 1, p_currency: pay.currency })
    expect(bad.error).not.toBeNull()
    const { count } = await svc.from('orders').select('id', { count: 'exact', head: true }).eq('payment_id', pay.id)
    expect(count).toBe(0)
  })

  it('ignores self-referral and non-affiliate referrers', async () => {
    const own = await buy(affiliateId, [await newTestBook()], affiliateId)
    expect(own.affiliate_id).toBeNull()
    const notAff = await buy(buyerId, [await newTestBook()], customerId)
    expect(notAff.affiliate_id).toBeNull()
  })

  it('does not accrue a commission for a payment without a referrer', async () => {
    const pay = await buy(buyerId, [await newTestBook()], null)
    const { data: order } = await fulfill(pay)
    const { count } = await svc.from('affiliate_commissions').select('id', { count: 'exact', head: true }).eq('order_id', order as string)
    expect(count).toBe(0)
  })
})

describe('withdrawals', () => {
  async function credit(amount: number) {
    // fixture: an already-available credit (service role may append to the ledger; nothing can update/delete it)
    const { error } = await svc.from('affiliate_ledger').insert({ affiliate_id: affiliateId, entry_type: 'adjustment', amount, currency: 'USD', available_at: new Date(Date.now() - 1000).toISOString(), memo: '[test-d] fixture', is_test: false })
    expect(error).toBeNull()
  }

  it('enforces minimum, available balance and payout method', async () => {
    await credit(300)
    const below = await svc.rpc('request_withdrawal', { p_affiliate: affiliateId, p_amount: Math.max(0.01, settings.min - 1) })
    expect(below.error?.message).toMatch(/minimum/)
    const bal = await balance(affiliateId)
    const over = await svc.rpc('request_withdrawal', { p_affiliate: affiliateId, p_amount: bal.available + 1 })
    expect(over.error?.message).toMatch(/insufficient/)
    const noMethod = await svc.rpc('request_withdrawal', { p_affiliate: buyerId, p_amount: 500 })
    expect(noMethod.error).not.toBeNull() // not an affiliate at all
  })

  it('serialises concurrent requests: only one of two that together exceed the balance succeeds', async () => {
    await credit(300)
    const bal = await balance(affiliateId)
    const amount = Math.floor((bal.available * 0.6) * 100) / 100
    expect(amount).toBeGreaterThanOrEqual(settings.min)
    const results = await Promise.all([
      svc.rpc('request_withdrawal', { p_affiliate: affiliateId, p_amount: amount }),
      svc.rpc('request_withdrawal', { p_affiliate: affiliateId, p_amount: amount }),
    ])
    const ok = results.filter((r) => !r.error)
    expect(ok).toHaveLength(1)
    expect(results.filter((r) => r.error)[0]!.error!.message).toMatch(/insufficient/)
    // reject it again so nothing stays pending and the hold is released
    const adminId = await userId(DEV_USERS.admin)
    const { error } = await svc.rpc('decide_withdrawal', { p_request: ok[0]!.data as string, p_admin: adminId, p_approve: false, p_note: '[test-d] concurrency' })
    expect(error).toBeNull()
  })

  it('paid keeps the hold, rejected releases it; a decided request cannot be decided again', async () => {
    await credit(300)
    const adminId = await userId(DEV_USERS.admin)
    const start = await balance(affiliateId)
    const amt = settings.min
    const a = (await svc.rpc('request_withdrawal', { p_affiliate: affiliateId, p_amount: amt })).data as string
    const b = (await svc.rpc('request_withdrawal', { p_affiliate: affiliateId, p_amount: amt })).data as string
    const held = await balance(affiliateId)
    expect(held.available).toBeCloseTo(start.available - 2 * amt, 2)
    expect(held.pending).toBeCloseTo(start.pending + 2 * amt, 2)

    expect((await svc.rpc('decide_withdrawal', { p_request: a, p_admin: adminId, p_approve: true, p_note: 'paid' })).error).toBeNull()
    expect((await svc.rpc('decide_withdrawal', { p_request: b, p_admin: adminId, p_approve: false, p_note: 'no' })).error).toBeNull()
    const end = await balance(affiliateId)
    expect(end.available).toBeCloseTo(start.available - amt, 2) // only the paid one left the balance
    expect(end.paidOut).toBeCloseTo(start.paidOut + amt, 2)
    expect(end.pending).toBeCloseTo(start.pending, 2)

    const again = await svc.rpc('decide_withdrawal', { p_request: a, p_admin: adminId, p_approve: false })
    expect(again.error?.message).toMatch(/already decided/)
  })

  it('ledger is append-only (update and delete are refused)', async () => {
    const { data: row } = await svc.from('affiliate_ledger').select('id').eq('affiliate_id', affiliateId).limit(1).single()
    const upd = await svc.from('affiliate_ledger').update({ amount: 999999 }).eq('id', row!.id)
    expect(upd.error?.message).toMatch(/append-only/)
    const del = await svc.from('affiliate_ledger').delete().eq('id', row!.id)
    expect(del.error?.message).toMatch(/append-only/)
  })
})

describe('isolation through the Data API', () => {
  it("an affiliate cannot read another affiliate's commissions, ledger, withdrawals or payout methods", async () => {
    const { client: other } = await signedInClient(DEV_USERS.customer2)
    for (const t of ['affiliate_commissions', 'affiliate_ledger', 'withdrawal_requests', 'payout_methods'] as const) {
      const { data, error } = await other.from(t).select('*').eq('affiliate_id', affiliateId)
      // withdrawal_requests has column grants (select * is refused) — either an error or an empty set means no leak
      expect(error ? [] : data).toEqual([])
    }
    const { client: aff } = await signedInClient(DEV_USERS.affiliate)
    const own = await aff.from('affiliate_commissions').select('id').limit(1)
    expect(own.data?.length).toBe(1)
    const pm = await aff.from('payout_methods').select('kind')
    expect(pm.data?.length).toBeGreaterThan(0)
  })

  it('payout methods are only writable by the owner affiliate (customers are denied)', async () => {
    const { client: cust, userId: uid } = await signedInClient(DEV_USERS.customer)
    const { error } = await cust.from('payout_methods').insert({ affiliate_id: uid, kind: 'paypal', details: {} })
    expect(error).not.toBeNull()
  })

  it('trusted functions are not callable through the Data API', async () => {
    const { client: cust, userId: uid } = await signedInClient(DEV_USERS.customer)
    const calls = [
      cust.rpc('request_withdrawal', { p_affiliate: uid, p_amount: 500 }),
      cust.rpc('decide_withdrawal', { p_request: randomUUID(), p_admin: uid, p_approve: true }),
      cust.rpc('approve_contributor_request', { p_request: randomUUID(), p_admin: uid }),
      cust.rpc('decline_contributor_request', { p_request: randomUUID(), p_admin: uid }),
      cust.rpc('fulfill_payment', { p_payment_id: randomUUID(), p_provider_txn: 'x', p_amount: 1, p_currency: 'USD' }),
      cust.rpc('admin_affiliate_overview'),
      cust.rpc('find_user_id_by_email', { p_email: DEV_USERS.admin }),
      cust.rpc('contributor_book_stats', { p_user: uid }),
    ]
    for (const r of await Promise.all(calls)) expect(r.error).not.toBeNull()
    // affiliate_balance is callable by authenticated users but only for themselves
    const mine = await cust.rpc('affiliate_balance', { p_affiliate: uid })
    expect(mine.error).toBeNull()
    const theirs = await cust.rpc('affiliate_balance', { p_affiliate: affiliateId })
    expect(theirs.error).not.toBeNull()
  })

  it('profiles.is_affiliate cannot be self-granted through the Data API', async () => {
    const { client: cust, userId: uid } = await signedInClient(DEV_USERS.customer)
    const { error } = await cust.from('profiles').update({ is_affiliate: true } as never).eq('id', uid)
    expect(error).not.toBeNull()
    const { data } = await svc.from('profiles').select('is_affiliate').eq('id', uid).single()
    expect(data?.is_affiliate).toBe(false)
  })
})

describe('contributor requests', () => {
  async function newRequest() {
    const { data, error } = await svc.from('contributor_requests').insert({ user_id: contributorId, title: `[test-d] ${randomUUID().slice(0, 8)}`, about: 'x', deal: 'share', cost: 12, whatsapp: '+0', iban: 'TEST' }).select('id').single()
    expect(error).toBeNull()
    return data!.id
  }

  it('approval creates exactly one DRAFT book owned by the contributor; a second review fails', async () => {
    const adminId = await userId(DEV_USERS.admin)
    const id = await newRequest()
    const first = await svc.rpc('approve_contributor_request', { p_request: id, p_admin: adminId, p_note: 'ok' })
    expect(first.error).toBeNull()
    const bookId = first.data as number
    const { data: book } = await svc.from('books').select('status,owner_id,price_amount,kind').eq('id', bookId).single()
    expect(book).toMatchObject({ status: 'draft', owner_id: contributorId, kind: 'paid' })
    expect(Number(book!.price_amount)).toBe(12)

    expect((await svc.rpc('approve_contributor_request', { p_request: id, p_admin: adminId })).error?.message).toMatch(/already reviewed/)
    expect((await svc.rpc('decline_contributor_request', { p_request: id, p_admin: adminId })).error).not.toBeNull()
    const { count } = await svc.from('books').select('id', { count: 'exact', head: true }).eq('owner_id', contributorId).eq('title', (await svc.from('books').select('title').eq('id', bookId).single()).data!.title)
    expect(count).toBe(1)
    await svc.from('books').update({ status: 'archived' }).eq('id', bookId) // keep the catalog clean
  })

  it('owners read only their own requests; other users and anon read none', async () => {
    const id = await newRequest()
    const { client: owner } = await signedInClient(DEV_USERS.contributor)
    expect((await owner.from('contributor_requests').select('id').eq('id', id)).data).toHaveLength(1)
    const { client: other } = await signedInClient(DEV_USERS.customer)
    expect((await other.from('contributor_requests').select('id').eq('id', id)).data).toEqual([])
    const { client: admin } = await signedInClient(DEV_USERS.admin)
    expect((await admin.from('contributor_requests').select('id').eq('id', id)).data).toHaveLength(1)
    const { anonClient } = await import('../helpers/supabase')
    expect((await anonClient().from('contributor_requests').select('id').eq('id', id)).data ?? []).toEqual([])
    await svc.rpc('decline_contributor_request', { p_request: id, p_admin: await userId(DEV_USERS.admin), p_note: '[test-d] cleanup' })
  })
})
