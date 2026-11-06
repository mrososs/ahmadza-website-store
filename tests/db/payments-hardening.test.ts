// Money guarantees at the database: concurrent and replayed fulfilment create exactly one order / entitlement / commission, a callback is bound to the
// gateway-signed order id, late or mismatched captures are flagged for the admin instead of lost, privileges, and the download audit log.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestUser, demoPaidBooks, setAllowTestPayments, tx } from '../helpers/commerce'
import { anonClient, serviceClient, signedInClient, DEV_USERS } from '../helpers/supabase'

const svc = serviceClient()
let was = true

beforeAll(async () => {
  was = (await svc.from('site_settings').select('allow_test_payments').eq('id', 1).single()).data!.allow_test_payments
  await setAllowTestPayments(true)
})
afterAll(async () => { await setAllowTestPayments(was) })

async function newPayment(opts: { affiliate?: string } = {}) {
  const user = await createTestUser()
  const [book] = await demoPaidBooks(1)
  const { data, error } = await svc.rpc('create_payment_for_cart', { p_user: user.id, p_book_ids: [book!.id], p_affiliate: (opts.affiliate ?? null) as never, p_provider: 'paymob', p_mode: 'test' })
  if (error) throw new Error(error.message)
  const pay = data as unknown as { id: string; reference: string; amount: number; currency: string }
  return { user, book: book!, pay }
}
const fulfil = (id: string, amount: number, currency: string, txn = tx()) => svc.rpc('fulfill_payment', { p_payment_id: id, p_provider_txn: txn, p_amount: amount, p_currency: currency })

describe('concurrent and replayed fulfilment', () => {
  it('twenty simultaneous callbacks for one payment create exactly one order and one entitlement', async () => {
    const { user, pay } = await newPayment()
    const txn = tx()
    const results = await Promise.all(Array.from({ length: 20 }, () => fulfil(pay.id, Number(pay.amount), pay.currency, txn)))
    expect(results.every((r) => !r.error)).toBe(true)
    expect(new Set(results.map((r) => r.data)).size).toBe(1)
    expect((await svc.from('orders').select('id', { count: 'exact', head: true }).eq('payment_id', pay.id)).count).toBe(1)
    expect((await svc.from('entitlements').select('id', { count: 'exact', head: true }).eq('user_id', user.id)).count).toBe(1)
  })
  it('a replay after settlement returns the same order and changes nothing; the gateway transaction id cannot be reused on another payment', async () => {
    const { pay } = await newPayment()
    const txn = tx()
    const first = await fulfil(pay.id, Number(pay.amount), pay.currency, txn)
    const again = await fulfil(pay.id, Number(pay.amount), pay.currency, txn)
    expect(again.data).toBe(first.data)
    const other = await newPayment()
    const reuse = await fulfil(other.pay.id, Number(other.pay.amount), other.pay.currency, txn)
    expect(reuse.error).toBeTruthy() // provider_transaction_id is unique
    expect((await svc.from('payments').select('status,order_id').eq('id', other.pay.id).single()).data).toMatchObject({ status: 'pending', order_id: null })
  })
  it('concurrent callbacks produce exactly one affiliate commission and one ledger entry', async () => {
    const affiliate = await createTestUser({ affiliate: true })
    const { pay } = await newPayment({ affiliate: affiliate.id })
    await Promise.all(Array.from({ length: 10 }, () => fulfil(pay.id, Number(pay.amount), pay.currency, `C-${pay.id}`)))
    const order = (await svc.from('orders').select('id').eq('payment_id', pay.id).single()).data!
    expect((await svc.from('affiliate_commissions').select('id', { count: 'exact', head: true }).eq('order_id', order.id)).count).toBe(1)
    expect((await svc.from('affiliate_ledger').select('id', { count: 'exact', head: true }).eq('affiliate_id', affiliate.id)).count).toBe(1)
  })
  it('the same provider event id is recorded once, so a webhook retry is reported as a duplicate', async () => {
    const { pay } = await newPayment()
    const ev = `evt-${randomUUID()}`
    const args = { p_provider: 'paymob', p_event_id: ev, p_payment_id: pay.id, p_type: 'succeeded', p_payload: { ok: true } }
    expect((await svc.rpc('register_payment_event', args)).data).toBe(true)
    expect((await svc.rpc('register_payment_event', args)).data).toBe(false)
  })
})

describe('amount and currency are checked in the database, against the stored payment', () => {
  it('a wrong amount or a wrong currency never creates an order', async () => {
    const { pay } = await newPayment()
    expect((await fulfil(pay.id, Number(pay.amount) - 0.01, pay.currency)).error?.code).toBe('22023')
    expect((await fulfil(pay.id, Number(pay.amount), pay.currency === 'USD' ? 'SAR' : 'USD')).error?.code).toBe('22023')
    expect((await svc.from('orders').select('id', { count: 'exact', head: true }).eq('payment_id', pay.id)).count).toBe(0)
  })
  it('failed and cancelled payments cannot be fulfilled afterwards (the late capture is flagged instead, see below)', async () => {
    const { pay } = await newPayment()
    await svc.rpc('fail_payment', { p_payment_id: pay.id, p_status: 'failed' })
    expect((await fulfil(pay.id, Number(pay.amount), pay.currency)).error?.code).toBe('22023')
  })
  it('a failure callback cannot undo a payment that was already fulfilled', async () => {
    const { pay } = await newPayment()
    await fulfil(pay.id, Number(pay.amount), pay.currency)
    await svc.rpc('fail_payment', { p_payment_id: pay.id, p_status: 'failed' })
    expect((await svc.from('payments').select('status').eq('id', pay.id).single()).data?.status).toBe('succeeded')
  })
})

describe('binding a callback to the gateway-signed order id', () => {
  it('finds the payment only when the gateway order id matches, and a reference alone is never enough', async () => {
    const { pay } = await newPayment()
    const order = `ord-${randomUUID()}`
    await svc.rpc('attach_provider_session', { p_payment_id: pay.id, p_provider_order_id: order })
    expect((await svc.rpc('find_payment_for_callback', { p_provider: 'paymob', p_reference: pay.reference, p_provider_order_id: order })).data).toBe(pay.id)
    expect((await svc.rpc('find_payment_for_callback', { p_provider: 'paymob', p_reference: null as never, p_provider_order_id: order })).data).toBe(pay.id)
    expect((await svc.rpc('find_payment_for_callback', { p_provider: 'paymob', p_reference: pay.reference, p_provider_order_id: 'someone-elses-order' })).data).toBeNull()
    expect((await svc.rpc('find_payment_for_callback', { p_provider: 'tap', p_reference: pay.reference, p_provider_order_id: order })).data).toBeNull() // another provider
    expect((await svc.rpc('find_payment_for_callback', { p_provider: 'paymob', p_reference: randomUUID(), p_provider_order_id: order })).data).toBeNull() // reference of a different payment
    expect((await svc.rpc('find_payment_for_callback', { p_provider: 'paymob', p_reference: pay.reference, p_provider_order_id: '' })).data).toBeNull()
  })
  it('the gateway order id is attached once only and is unique per provider', async () => {
    const a = await newPayment(); const b = await newPayment()
    const order = `ord-${randomUUID()}`
    await svc.rpc('attach_provider_session', { p_payment_id: a.pay.id, p_provider_order_id: order })
    await svc.rpc('attach_provider_session', { p_payment_id: a.pay.id, p_provider_order_id: 'replacement' })
    expect((await svc.from('payments').select('provider_order_id').eq('id', a.pay.id).single()).data?.provider_order_id).toBe(order)
    const dup = await svc.rpc('attach_provider_session', { p_payment_id: b.pay.id, p_provider_order_id: order })
    expect(dup.error?.code).toBe('23505')
  })
})

describe('money that cannot be fulfilled stays visible', () => {
  it('flag_payment_review marks the payment for the admin with a reason, once', async () => {
    const { pay } = await newPayment()
    await svc.rpc('flag_payment_review', { p_payment_id: pay.id, p_reason: 'captured after expiry' })
    const row = (await svc.from('payments').select('needs_review,review_reason,review_flagged_at').eq('id', pay.id).single()).data!
    expect(row).toMatchObject({ needs_review: true, review_reason: 'captured after expiry' })
    const firstFlag = row.review_flagged_at
    await svc.rpc('flag_payment_review', { p_payment_id: pay.id, p_reason: 'again' })
    expect((await svc.from('payments').select('review_flagged_at').eq('id', pay.id).single()).data?.review_flagged_at).toBe(firstFlag)
  })
})

describe('privileges', () => {
  it('none of the new payment or audit functions can be called from the browser roles', async () => {
    const { client } = await signedInClient(DEV_USERS.admin)
    const calls: [string, Record<string, unknown>][] = [
      ['attach_provider_session', { p_payment_id: randomUUID(), p_provider_order_id: 'x' }],
      ['find_payment_for_callback', { p_provider: 'paymob', p_reference: randomUUID(), p_provider_order_id: 'x' }],
      ['flag_payment_review', { p_payment_id: randomUUID(), p_reason: 'x' }],
      ['log_media_download', { p_media: 1, p_book: 1, p_user: randomUUID(), p_outcome: 'granted' }],
      ['verify_book', { p_book: 1, p_admin: randomUUID() }],
    ]
    for (const [fn, args] of calls) {
      for (const c of [anonClient(), client]) {
        const r = await (c as unknown as { rpc: (f: string, a: unknown) => Promise<{ error: { code?: string } | null }> }).rpc(fn, args)
        expect(r.error, `${fn} must be refused`).toBeTruthy()
      }
    }
  })
  it('payments stay unreadable to other customers, and the download log is admin-read only', async () => {
    const { pay } = await newPayment()
    const { client } = await signedInClient(DEV_USERS.customer)
    expect((await client.from('payments').select('id').eq('id', pay.id)).data ?? []).toHaveLength(0)
    expect((await client.from('media_download_log').select('id').limit(1)).data ?? []).toHaveLength(0)
    expect((await anonClient().from('media_download_log').select('id').limit(1)).error).toBeTruthy()
  })
})

describe('download audit log', () => {
  it('records outcomes and rejects an unknown outcome', async () => {
    const [book] = await demoPaidBooks(1)
    const user = await createTestUser()
    expect((await svc.rpc('log_media_download', { p_media: book!.mediaId, p_book: book!.id, p_user: user.id, p_outcome: 'granted' })).error).toBeNull()
    expect((await svc.rpc('log_media_download', { p_media: book!.mediaId, p_book: book!.id, p_user: user.id, p_outcome: 'denied_purchase', p_reason: 'no entitlement' })).error).toBeNull()
    expect((await svc.rpc('log_media_download', { p_media: book!.mediaId, p_book: book!.id, p_user: user.id, p_outcome: 'made_up' })).error).toBeTruthy()
    const rows = (await svc.from('media_download_log').select('outcome,reason').eq('user_id', user.id)).data ?? []
    expect(rows.map((r) => r.outcome).sort()).toEqual(['denied_purchase', 'granted'])
    const admin = await signedInClient(DEV_USERS.admin)
    expect(((await admin.client.from('media_download_log').select('id').eq('user_id', user.id)).data ?? []).length).toBe(2)
  })
})
