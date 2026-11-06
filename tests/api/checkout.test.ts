import { afterAll, describe, expect, it } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { apiAs, serviceClient, SUPABASE_URL } from '../helpers/supabase'
import { createTestUser, demoPaidBooks, setAllowTestPayments } from '../helpers/commerce'

const admin = serviceClient()
const sign = (raw: string) => createHmac('sha256', 'local-dev-only-webhook-secret').update(raw).digest('hex')

afterAll(() => setAllowTestPayments(true))

async function startCheckout(email: string, bookIds: number[], headers: Record<string, string> = {}) {
  const api = await apiAs(email)
  const res = await api('/api/checkout/session', { method: 'POST', json: { bookIds, price: 0.01, total: 0.01 }, headers })
  return { api, res, body: await res.json().catch(() => ({})) as { reference: string; amount: number; currency: string; redirectUrl: string } }
}

describe('POST /api/cart/quote', () => {
  it('prices come from the database; forged client prices are ignored; unknown ids are reported', async () => {
    const [book] = await demoPaidBooks(1)
    const api = await apiAs(null)
    const res = await api('/api/cart/quote', { method: 'POST', json: { bookIds: [book!.id, 99999999], items: [{ id: book!.id, price: 0.01 }], total: 0.01 } })
    expect(res.status).toBe(200)
    const q = await res.json()
    expect(q.total).toBe(book!.price)
    expect(q.items).toHaveLength(1)
    expect(q.items[0].unit_price).toBe(book!.price)
    expect(q.unavailable).toEqual([99999999])
  })

  it('does not quote free or draft books, and reports owned ones', async () => {
    const [book] = await demoPaidBooks(1)
    const free = (await admin.from('books').select('id').eq('is_demo', true).eq('kind', 'free').eq('status', 'published').limit(1)).data![0]!
    const buyer = await createTestUser()
    const { api, body } = await startCheckout(buyer.email, [book!.id])
    await api(`/api/checkout/simulate/${body.reference}`, { method: 'POST', json: { outcome: 'success' } })
    const q = await (await api('/api/cart/quote', { method: 'POST', json: { bookIds: [book!.id, free.id] } })).json()
    expect(q.owned).toEqual([book!.id])
    expect(q.unavailable).toEqual([free.id])
    expect(q.items).toHaveLength(0)
    expect(q.total).toBe(0)
  })
})

describe('checkout session', () => {
  it('requires authentication', async () => {
    const [book] = await demoPaidBooks(1)
    const res = await (await apiAs(null))('/api/checkout/session', { method: 'POST', json: { bookIds: [book!.id] } })
    expect(res.status).toBe(401)
  })

  it('creates a pending payment priced by the server and points to the simulator', async () => {
    const [book] = await demoPaidBooks(1)
    const u = await createTestUser()
    const { res, body } = await startCheckout(u.email, [book!.id])
    expect(res.status).toBe(200)
    expect(body.amount).toBe(book!.price) // not the forged 0.01
    expect(body.redirectUrl).toBe(`/checkout/simulate/${body.reference}`)
    const pay = (await admin.from('payments').select('status,mode,provider,amount').eq('reference', body.reference).single()).data!
    expect(pay).toMatchObject({ status: 'pending', mode: 'test', provider: 'dev_simulator' })
    expect((await admin.from('orders').select('id').eq('user_id', u.id)).data).toHaveLength(0) // no order before a verified payment
  })

  it('refuses banned accounts', async () => {
    const [book] = await demoPaidBooks(1)
    const u = await createTestUser({ status: 'banned' })
    const { res } = await startCheckout(u.email, [book!.id])
    expect(res.status).toBe(403)
  })

  it('attributes the affiliate from the cookie only (body value ignored)', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser(); const aff = await createTestUser({ affiliate: true }); const decoy = await createTestUser({ affiliate: true })
    const api = await apiAs(buyer.email)
    const res = await api('/api/checkout/session', { method: 'POST', json: { bookIds: [book!.id], affiliateRef: decoy.id }, headers: { cookie: `aw_aff=${aff.id}` } })
    const body = await res.json()
    const pay = (await admin.from('payments').select('affiliate_id').eq('reference', body.reference).single()).data!
    expect(pay.affiliate_id).toBe(aff.id)
  })
})

describe('simulate -> entitlement -> download', () => {
  it('success grants the entitlement and the download is a signed URL that serves the real PDF', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser(); const stranger = await createTestUser()
    const { api, body } = await startCheckout(buyer.email, [book!.id])

    // before paying: guest 401, logged-in non-entitled 403
    expect((await (await apiAs(null))(`/api/library/download/${book!.mediaId}`)).status).toBe(401)
    expect((await api(`/api/library/download/${book!.mediaId}`)).status).toBe(403)

    // a different user cannot complete the buyer's payment
    const strangerApi = await apiAs(stranger.email)
    expect((await strangerApi(`/api/checkout/simulate/${body.reference}`, { method: 'POST', json: { outcome: 'success' } })).status).toBe(404)

    const sim = await api(`/api/checkout/simulate/${body.reference}`, { method: 'POST', json: { outcome: 'success', amount: 0.01 } })
    expect(sim.status).toBe(200)
    expect((await sim.json()).status).toBe('succeeded')
    const ent = (await admin.from('entitlements').select('is_test').eq('user_id', buyer.id)).data!
    expect(ent).toEqual([{ is_test: true }])

    const dl = await api(`/api/library/download/${book!.mediaId}`)
    expect(dl.status).toBe(302)
    const location = dl.headers.get('location')!
    expect(location).toContain('/storage/v1/object/sign/private-products/')
    const file = await fetch(location)
    expect(file.status).toBe(200)
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')

    // the other user is still refused
    expect((await strangerApi(`/api/library/download/${book!.mediaId}`)).status).toBe(403)
  })

  it('private files are not reachable through the public bucket path nor unsigned', async () => {
    const [book] = await demoPaidBooks(1)
    const path = (await admin.from('book_media').select('storage_path').eq('id', book!.mediaId).single()).data!.storage_path!
    const pub = await fetch(`${SUPABASE_URL}/storage/v1/object/public/private-products/${path}`)
    expect(pub.status).toBeGreaterThanOrEqual(400)
    const unsigned = await fetch(`${SUPABASE_URL}/storage/v1/object/private-products/${path}`)
    expect(unsigned.status).toBeGreaterThanOrEqual(400)
  })

  it('preview media and free books are open to guests; storage paths are never in the response', async () => {
    const prev = (await admin.from('book_media').select('id,books!inner(status,is_demo,deleted_at)').eq('visibility', 'preview').eq('books.status', 'published').eq('books.is_demo', true).is('books.deleted_at', null).order('id').limit(1)).data![0]!
    const res = await (await apiAs(null))(`/api/library/download/${prev.id}`)
    expect(res.status).toBe(302)
    const free = (await admin.from('book_media').select('id,books!inner(kind,status,is_demo)').eq('visibility', 'after_purchase').eq('books.kind', 'free').eq('books.status', 'published').eq('books.is_demo', true).order('id').limit(1)).data![0]!
    expect((await (await apiAs(null))(`/api/library/download/${free.id}`)).status).toBe(302)
    expect((await (await apiAs(null))('/api/library/download/99999999')).status).toBe(404)
  })

  it('failure leaves no order, entitlement or trace of success', async () => {
    const [book] = await demoPaidBooks(1)
    const u = await createTestUser()
    const { api, body } = await startCheckout(u.email, [book!.id])
    const r = await api(`/api/checkout/simulate/${body.reference}`, { method: 'POST', json: { outcome: 'failure' } })
    expect((await r.json()).status).toBe('failed')
    expect((await admin.from('payments').select('status').eq('reference', body.reference).single()).data!.status).toBe('failed')
    expect((await admin.from('orders').select('id').eq('user_id', u.id)).data).toHaveLength(0)
    // a failed payment can no longer be fulfilled
    const again = await api(`/api/checkout/simulate/${body.reference}`, { method: 'POST', json: { outcome: 'success' } })
    expect(again.status).toBeGreaterThanOrEqual(400)
  })

  it('double-clicking success is idempotent (one order)', async () => {
    const [book] = await demoPaidBooks(1)
    const u = await createTestUser()
    const { api, body } = await startCheckout(u.email, [book!.id])
    const [a, b] = await Promise.all([1, 2].map(() => api(`/api/checkout/simulate/${body.reference}`, { method: 'POST', json: { outcome: 'success' } })))
    expect(a!.status).toBe(200); expect(b!.status).toBe(200)
    expect((await admin.from('orders').select('id').eq('user_id', u.id)).data).toHaveLength(1)
  })
})

describe('simulator guard', () => {
  it('is refused when allow_test_payments is off', async () => {
    const [book] = await demoPaidBooks(1)
    const u = await createTestUser()
    const { api, body } = await startCheckout(u.email, [book!.id])
    await setAllowTestPayments(false)
    try {
      const sim = await api(`/api/checkout/simulate/${body.reference}`, { method: 'POST', json: { outcome: 'success' } })
      expect(sim.status).toBe(403)
      const session = await startCheckout(u.email, [book!.id])
      expect(session.res.status).toBe(503) // with test payments off no method is available at all
      const raw = JSON.stringify({ event_id: randomUUID(), reference: body.reference, status: 'succeeded', transaction_id: 'x', amount: body.amount, currency: 'USD' })
      const hook = await fetch('http://localhost:3000/api/webhooks/payments/dev_simulator', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-aawraq-signature': sign(raw) } })
      expect(hook.status).toBe(403)
    } finally { await setAllowTestPayments(true) }
    expect((await admin.from('orders').select('id').eq('user_id', u.id)).data).toHaveLength(0)
  })

  it('real gateways refuse an unsigned or malformed webhook (never 200) and unknown providers are 404', async () => {
    const hook = (p: string) => fetch(`http://localhost:3000/api/webhooks/payments/${p}`, { method: 'POST', body: '{}' })
    expect([400, 401]).toContain((await hook('paymob')).status)
    expect([400, 401]).toContain((await hook('tap')).status)
    expect((await hook('nope')).status).toBe(404)
  })
})

describe('webhook', () => {
  const post = (raw: string, signature = sign(raw)) =>
    fetch('http://localhost:3000/api/webhooks/payments/dev_simulator', { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-aawraq-signature': signature } })

  it('rejects bad signatures; replays create exactly one order / entitlement / commission', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser(); const aff = await createTestUser({ affiliate: true })
    const api = await apiAs(buyer.email)
    const body = await (await api('/api/checkout/session', { method: 'POST', json: { bookIds: [book!.id] }, headers: { cookie: `aw_aff=${aff.id}` } })).json()
    const raw = JSON.stringify({ event_id: `evt-${randomUUID()}`, reference: body.reference, status: 'succeeded', transaction_id: `TX-${randomUUID()}`, amount: body.amount, currency: 'USD' })

    expect((await post(raw, 'deadbeef')).status).toBe(401)
    expect((await post(raw, sign(raw + ' '))).status).toBe(401)
    expect((await admin.from('orders').select('id').eq('user_id', buyer.id)).data).toHaveLength(0)

    const first = await post(raw)
    expect(first.status).toBe(200)
    const f = await first.json()
    expect(f.duplicate).toBe(false)
    const replays = await Promise.all([post(raw), post(raw), post(raw)])
    for (const r of replays) { expect(r.status).toBe(200); const j = await r.json(); expect(j.duplicate).toBe(true); expect(j.orderId).toBe(f.orderId) }

    expect((await admin.from('orders').select('id').eq('user_id', buyer.id)).data).toHaveLength(1)
    expect((await admin.from('entitlements').select('id').eq('user_id', buyer.id)).data).toHaveLength(1)
    expect((await admin.from('affiliate_commissions').select('id').eq('affiliate_id', aff.id)).data).toHaveLength(1)
    expect((await admin.from('payment_events').select('id').eq('payment_id', (await admin.from('payments').select('id').eq('reference', body.reference).single()).data!.id)).data).toHaveLength(1)
  })

  it('a webhook with a wrong amount creates nothing: the payment is flagged for the admin and the gateway gets a 200 so it stops retrying', async () => {
    const [book] = await demoPaidBooks(1)
    const buyer = await createTestUser()
    const body = await (await (await apiAs(buyer.email))('/api/checkout/session', { method: 'POST', json: { bookIds: [book!.id] } })).json()
    const raw = JSON.stringify({ event_id: `evt-${randomUUID()}`, reference: body.reference, status: 'succeeded', transaction_id: 'TX', amount: 0.01, currency: 'USD' })
    const res = await post(raw)
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('needs_review')
    expect((await admin.from('orders').select('id').eq('user_id', buyer.id)).data).toHaveLength(0)
    expect((await admin.from('payments').select('needs_review,status').eq('reference', body.reference).single()).data).toMatchObject({ needs_review: true, status: 'pending' })
  })
})
