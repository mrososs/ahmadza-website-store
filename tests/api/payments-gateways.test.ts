// Paymob and Tap end to end WITHOUT credentials: a real Nuxt server (own port, own build dir) talks to a MOCK gateway that this test controls.
// Proves the whole server side: session creation priced from the database, signed webhooks, Tap's API re-fetch, browser return, idempotency under
// concurrency, tampering, key-mode isolation, late and mismatching captures, reversals. It proves nothing about the REAL gateways: both stay NOT VERIFIED
// until an authorised sandbox run (docs/implementation/PAYMENTS_GO_LIVE_CHECKLIST.md). Uses the LOCAL dev Supabase (synthetic data).
import { createHmac, randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postFields, getFields } from '../../server/services/payments/paymob'
import { tapSignedString } from '../../server/services/payments/tap'
import { apiAs, serviceClient } from '../helpers/supabase'
import { createTestUser, demoPaidBooks, setAllowTestPayments } from '../helpers/commerce'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PORT = 3191
const BASE = `http://localhost:${PORT}`
const svc = serviceClient()
const SECRETS = { paymobSk: 'sk_test_mock', paymobPk: 'pk_test_mock', testHmac: 'mock-test-hmac', liveHmac: 'mock-live-hmac', tapTest: 'sk_test_tap_mock', tapLive: 'sk_live_tap_mock' }

// ---- mock gateway -------------------------------------------------------------------------------------------------------------------------------
interface Mock { server?: Server; url: string; intentions: { auth: string; body: Record<string, unknown> }[]; tapCharges: Map<string, Record<string, unknown>>; tapAuth: string[]; failNextIntention: boolean; seq: number }
const mock: Mock = { url: '', intentions: [], tapCharges: new Map(), tapAuth: [], failNextIntention: false, seq: 0 }
const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => resolve(b)) })

async function startMock() {
  mock.server = createServer(async (req, res) => {
    const send = (code: number, json: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)) }
    const body = await readBody(req)
    if (req.method === 'POST' && req.url === '/paymob/v1/intention/') {
      if (mock.failNextIntention) { mock.failNextIntention = false; return send(500, { detail: 'gateway exploded: internal detail' }) }
      mock.intentions.push({ auth: String(req.headers.authorization), body: JSON.parse(body) })
      return send(201, { id: `int_${++mock.seq}`, client_secret: `cs_${mock.seq}`, intention_order_id: Date.now() * 1000 + mock.seq })
    }
    if (req.method === 'POST' && req.url === '/tap/charges') {
      mock.tapAuth.push(String(req.headers.authorization))
      const sent = JSON.parse(body)
      const id = `chg_MOCK${Date.now()}${++mock.seq}`
      const charge = { id, object: 'charge', status: 'INITIATED', amount: sent.amount, currency: sent.currency, reference: { ...sent.reference, gateway: '', payment: '' }, metadata: sent.metadata, transaction: { created: String(Date.now()), url: 'https://checkout.payments.tap.company/mock' }, response: { code: '100', message: 'Initiated' } }
      mock.tapCharges.set(id, charge)
      return send(200, charge)
    }
    const m = /^\/tap\/charges\/(chg_[A-Za-z0-9_]+)$/.exec(req.url ?? '')
    if (req.method === 'GET' && m) {
      mock.tapAuth.push(String(req.headers.authorization))
      const c = mock.tapCharges.get(m[1]!)
      return c ? send(200, c) : send(404, { errors: [{ code: '1144' }] })
    }
    send(404, {})
  })
  await new Promise<void>((r) => mock.server!.listen(0, '127.0.0.1', r))
  mock.url = `http://127.0.0.1:${(mock.server!.address() as AddressInfo).port}`
}

// ---- the server under test ---------------------------------------------------------------------------------------------------------------------
let app: ChildProcess | undefined
let log = ''
async function startApp() {
  app = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['nuxt', 'dev', '--port', String(PORT), '--extends', './scripts/dev/recovery-layer'], {
    cwd: ROOT, shell: process.platform === 'win32',
    env: {
      ...process.env, NUXT_TELEMETRY_DISABLED: '1',
      NUXT_PAYMENTS_ENABLED_PROVIDERS: 'paymob,tap', NUXT_PAYMENTS_PUBLIC_BASE_URL: BASE,
      NUXT_PAYMOB_BASE_URL: `${mock.url}/paymob`, NUXT_PAYMOB_CHECKOUT_URL: `${mock.url}/paymob-checkout`,
      NUXT_PAYMOB_TEST_SECRET_KEY: SECRETS.paymobSk, NUXT_PAYMOB_TEST_PUBLIC_KEY: SECRETS.paymobPk, NUXT_PAYMOB_TEST_HMAC_SECRET: SECRETS.testHmac, NUXT_PAYMOB_TEST_INTEGRATION_IDS: '1256,1257',
      NUXT_PAYMOB_LIVE_SECRET_KEY: 'sk_live_mock', NUXT_PAYMOB_LIVE_PUBLIC_KEY: 'pk_live_mock', NUXT_PAYMOB_LIVE_HMAC_SECRET: SECRETS.liveHmac, NUXT_PAYMOB_LIVE_INTEGRATION_IDS: '9001',
      NUXT_TAP_BASE_URL: `${mock.url}/tap`, NUXT_TAP_TEST_SECRET_KEY: SECRETS.tapTest, NUXT_TAP_LIVE_SECRET_KEY: SECRETS.tapLive,
    },
  })
  app.stdout?.on('data', (d) => { log += String(d) }); app.stderr?.on('data', (d) => { log += String(d) })
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${BASE}/api/checkout/methods`)).status === 200) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`server did not start:\n${log.slice(-1500)}`)
}

let was = true
beforeAll(async () => {
  was = (await svc.from('site_settings').select('allow_test_payments').eq('id', 1).single()).data!.allow_test_payments
  await setAllowTestPayments(true)
  await startMock()
  await startApp()
}, 240_000)
afterAll(async () => {
  await setAllowTestPayments(was)
  if (app?.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F']); else app.kill('SIGTERM') }
  await new Promise<void>((r) => (mock.server ? mock.server.close(() => r()) : r()))
})

// ---- helpers ------------------------------------------------------------------------------------------------------------------------------------
async function buyer() {
  const u = await createTestUser()
  const [book] = await demoPaidBooks(1)
  return { u, book: book!, api: await apiAs(u.email, BASE) }
}
async function startCheckout(provider: 'paymob' | 'tap', extra: Record<string, unknown> = {}) {
  const b = await buyer()
  const res = await b.api('/api/checkout/session', { method: 'POST', json: { bookIds: [b.book.id], provider, ...extra } })
  const body = res.status === 200 ? await res.json() : null
  const pay = body ? (await svc.from('payments').select('id,reference,provider_order_id,amount,currency,status,mode,needs_review,order_id').eq('reference', body.reference).single()).data! : null
  return { ...b, res, body, pay }
}
const orderCount = async (paymentId: string) => (await svc.from('orders').select('id', { count: 'exact', head: true }).eq('payment_id', paymentId)).count
const payRow = async (id: string) => (await svc.from('payments').select('status,order_id,needs_review,review_reason').eq('id', id).single()).data!

interface Tx { amount_cents: number; currency: string; success: boolean; pending: boolean; is_voided: boolean; is_refunded: boolean; error_occured: boolean; is_auth: boolean; is_capture: boolean; order: { id: string | number; merchant_order_id: string | null }; id: number }
const paymobTx = (pay: { amount: number | string; currency: string; provider_order_id: string | null; reference: string }, over: Partial<Tx> = {}): Tx => ({
  id: Math.floor(Math.random() * 1e9), amount_cents: Math.round(Number(pay.amount) * 100), currency: pay.currency, success: true, pending: false, is_voided: false, is_refunded: false,
  error_occured: false, is_auth: false, is_capture: false, order: { id: pay.provider_order_id!, merchant_order_id: pay.reference }, ...over,
})
const fullTx = (t: Tx) => ({ ...t, created_at: '2026-11-06T10:00:00.000000', has_parent_transaction: false, integration_id: 1256, is_3d_secure: true, is_standalone_payment: true, owner: 1, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' } })
const postPaymob = (t: Tx, secret = SECRETS.testHmac, hmacOverride?: string, type = 'TRANSACTION') => {
  const obj = fullTx(t)
  const hmac = hmacOverride ?? createHmac('sha512', secret).update(postFields(obj)).digest('hex')
  return fetch(`${BASE}/api/webhooks/payments/paymob?hmac=${hmac}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, obj }) })
}
const postTap = (charge: Record<string, unknown>, secret = SECRETS.tapTest, raw?: string) => {
  const body = raw ?? JSON.stringify(charge)
  const hashstring = createHmac('sha256', secret).update(tapSignedString(charge, Number(charge.amount).toFixed(2))).digest('hex')
  return fetch(`${BASE}/api/webhooks/payments/tap`, { method: 'POST', headers: { 'content-type': 'application/json', hashstring }, body })
}

// ---- Paymob -------------------------------------------------------------------------------------------------------------------------------------
describe('Paymob: session creation', () => {
  it('lists the methods that are available; credentials and reasons are not exposed', async () => {
    const r = await (await fetch(`${BASE}/api/checkout/methods`)).json()
    expect(r.methods.map((m: { id: string }) => m.id)).toEqual(['paymob', 'tap'])
    expect(r.methods.every((m: { available: boolean }) => m.available)).toBe(true)
    expect(JSON.stringify(r)).not.toMatch(/sk_test|hmac|missing|NUXT_/i)
  })
  it('prices from the database, sends the gateway an intention it can verify, stores the gateway order id, and ignores any browser-supplied total', async () => {
    const c = await startCheckout('paymob', { total: 0.01, amount: 1, price: 0.01 })
    expect(c.res.status).toBe(200)
    expect(c.body.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/paymob-checkout\/\?publicKey=pk_test_mock&clientSecret=cs_\d+$/)
    const sent = mock.intentions.at(-1)!
    expect(sent.auth).toBe(`Token ${SECRETS.paymobSk}`)
    expect(sent.body).toMatchObject({ amount: Math.round(c.book.price * 100), currency: 'USD', special_reference: c.pay!.reference, payment_methods: [1256, 1257], notification_url: `${BASE}/api/webhooks/payments/paymob` })
    expect(String(sent.body.redirection_url)).toContain(`/api/checkout/return/paymob?reference=${c.pay!.reference}`)
    expect(c.pay).toMatchObject({ status: 'pending', mode: 'test', amount: c.book.price })
    expect(c.pay!.provider_order_id).toMatch(/^\d+$/)
  })
  it('is refused for a guest, for a provider that is not enabled, and for a free or unknown book', async () => {
    const guest = await apiAs(null, BASE)
    expect((await guest('/api/checkout/session', { method: 'POST', json: { bookIds: [1], provider: 'paymob' } })).status).toBe(401)
    const b = await buyer()
    expect((await b.api('/api/checkout/session', { method: 'POST', json: { bookIds: [b.book.id], provider: 'dev_simulator' } })).status).toBe(403)
    expect((await b.api('/api/checkout/session', { method: 'POST', json: { bookIds: [999999999], provider: 'paymob' } })).status).toBe(409)
    expect((await b.api('/api/checkout/session', { method: 'POST', json: { bookIds: [b.book.id], provider: 'nonsense' } })).status).toBe(400)
  })
  it('a gateway failure answers 502 without leaking its message and leaves no pending payment behind', async () => {
    const b = await buyer()
    mock.failNextIntention = true
    const res = await b.api('/api/checkout/session', { method: 'POST', json: { bookIds: [b.book.id], provider: 'paymob' } })
    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).not.toContain('internal detail')
    const rows = (await svc.from('payments').select('status').eq('user_id', b.u.id)).data ?? []
    expect(rows.map((r) => r.status)).toEqual(['failed'])
  })
})

describe('Paymob: webhook settlement', () => {
  it('a correctly signed success creates exactly one order and entitlement; the retry is a duplicate; ten concurrent retries change nothing', async () => {
    const c = await startCheckout('paymob')
    const t = paymobTx(c.pay!)
    const first = await postPaymob(t)
    const f = await first.json()
    expect(first.status).toBe(200)
    expect(f).toMatchObject({ ok: true, duplicate: false })
    expect(typeof f.orderId).toBe('string')
    const again = await (await postPaymob(t)).json()
    expect(again).toMatchObject({ duplicate: true, orderId: f.orderId })
    const burst = await Promise.all(Array.from({ length: 10 }, () => postPaymob(t).then((r) => r.json())))
    expect(burst.every((r) => r.orderId === f.orderId)).toBe(true)
    expect(await orderCount(c.pay!.id)).toBe(1)
    expect((await svc.from('entitlements').select('id', { count: 'exact', head: true }).eq('user_id', c.u.id).eq('book_id', c.book.id)).count).toBe(1)
    expect(await payRow(c.pay!.id)).toMatchObject({ status: 'succeeded', needs_review: false })
  })
  it('a concurrent burst of the FIRST delivery still creates one order', async () => {
    const c = await startCheckout('paymob')
    const t = paymobTx(c.pay!)
    const results = await Promise.all(Array.from({ length: 12 }, () => postPaymob(t).then((r) => r.json())))
    expect(new Set(results.map((r) => r.orderId)).size).toBe(1)
    expect(await orderCount(c.pay!.id)).toBe(1)
  })
  it('rejects a bad, missing, or tampered signature with 401 and creates nothing', async () => {
    const c = await startCheckout('paymob')
    const t = paymobTx(c.pay!)
    expect((await postPaymob(t, SECRETS.testHmac, 'a'.repeat(128))).status).toBe(401)
    expect((await postPaymob(t, 'a-secret-nobody-configured')).status).toBe(401)
    const cheap = fullTx({ ...t, amount_cents: 1 })
    const goodSig = createHmac('sha512', SECRETS.testHmac).update(postFields(fullTx(t))).digest('hex')
    const r = await fetch(`${BASE}/api/webhooks/payments/paymob?hmac=${goodSig}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'TRANSACTION', obj: cheap }) })
    expect(r.status).toBe(401)
    expect((await fetch(`${BASE}/api/webhooks/payments/paymob`, { method: 'POST', body: JSON.stringify({ type: 'TRANSACTION', obj: fullTx(t) }) })).status).toBe(401)
    expect(await orderCount(c.pay!.id)).toBe(0)
  })
  it('a validly signed event for an order id we never issued is 404; another payment\'s signed event cannot settle this one', async () => {
    const a = await startCheckout('paymob'); const b = await startCheckout('paymob')
    expect((await postPaymob(paymobTx({ ...a.pay!, provider_order_id: '424242424242' }))).status).toBe(404)
    // an attacker holding a valid event for payment A replays it, swapping our (unsigned) reference to payment B's: the signed order id still points at A
    const forged = paymobTx({ ...a.pay!, reference: b.pay!.reference })
    expect((await postPaymob(forged)).status).toBe(404)
    expect(await orderCount(b.pay!.id)).toBe(0)
    expect(await orderCount(a.pay!.id)).toBe(0)
  })
  it('a captured amount that differs from the stored payment is NOT fulfilled: it is flagged for the admin and the gateway gets a 200', async () => {
    const c = await startCheckout('paymob')
    const r = await postPaymob(paymobTx(c.pay!, { amount_cents: 100 }))
    expect(r.status).toBe(200)
    expect((await r.json()).outcome).toBe('needs_review')
    expect(await orderCount(c.pay!.id)).toBe(0)
    expect(await payRow(c.pay!.id)).toMatchObject({ status: 'pending', needs_review: true })
    const wrongCurrency = await startCheckout('paymob')
    await postPaymob(paymobTx(wrongCurrency.pay!, { currency: 'SAR' }))
    expect(await orderCount(wrongCurrency.pay!.id)).toBe(0)
    expect((await payRow(wrongCurrency.pay!.id)).needs_review).toBe(true)
  })
  it('an event signed with the LIVE key can never settle a TEST payment', async () => {
    const c = await startCheckout('paymob')
    const r = await postPaymob(paymobTx(c.pay!), SECRETS.liveHmac)
    expect(r.status).toBe(200)
    expect((await r.json()).outcome).toBe('needs_review')
    expect(await orderCount(c.pay!.id)).toBe(0)
    expect((await payRow(c.pay!.id)).review_reason).toMatch(/live keys/)
  })
  it('a declined payment fails it; a LATER success for the same payment (money captured after we gave up) is flagged, not lost, and creates no order', async () => {
    const c = await startCheckout('paymob')
    const declined = await (await postPaymob(paymobTx(c.pay!, { success: false }))).json()
    expect(declined.outcome).toBe('failed')
    expect((await payRow(c.pay!.id)).status).toBe('failed')
    const late = await postPaymob(paymobTx(c.pay!))
    expect(late.status).toBe(200)
    expect((await late.json()).outcome).toBe('needs_review')
    expect(await orderCount(c.pay!.id)).toBe(0)
    expect((await payRow(c.pay!.id)).needs_review).toBe(true)
  })
  it('pending and authorised-only events change nothing; a refund after fulfilment is flagged and keeps the order', async () => {
    const c = await startCheckout('paymob')
    expect((await (await postPaymob(paymobTx(c.pay!, { success: false, pending: true }))).json()).outcome).toBe('pending')
    expect((await (await postPaymob(paymobTx(c.pay!, { is_auth: true, is_capture: false }))).json()).outcome).toBe('pending')
    expect((await payRow(c.pay!.id)).status).toBe('pending')
    const ok = await (await postPaymob(paymobTx(c.pay!))).json()
    const refund = await (await postPaymob(paymobTx(c.pay!, { is_refunded: true, success: true }))).json()
    expect(refund.outcome).toBe('needs_review')
    expect(await payRow(c.pay!.id)).toMatchObject({ status: 'succeeded', order_id: ok.orderId, needs_review: true })
  })
  it('a card-token callback is acknowledged and ignored', async () => {
    const r = await fetch(`${BASE}/api/webhooks/payments/paymob`, { method: 'POST', body: JSON.stringify({ type: 'TOKEN', obj: { token: 't' } }) })
    expect(r.status).toBe(200)
    expect((await r.json()).outcome).toBe('ignored')
  })
  it('the stored payload holds no card digits, billing or customer data', async () => {
    const c = await startCheckout('paymob')
    await postPaymob(paymobTx(c.pay!))
    const stored = (await svc.from('payments').select('raw_response').eq('id', c.pay!.id).single()).data!.raw_response
    expect(JSON.stringify(stored)).not.toMatch(/2346|billing|phone|email|pan/i)
    const events = (await svc.from('payment_events').select('payload').eq('payment_id', c.pay!.id)).data ?? []
    expect(JSON.stringify(events)).not.toMatch(/2346|billing|phone|email/i)
  })
  it('browser return: a correctly signed redirect settles the payment and sends the customer to the result page; a forged one only redirects', async () => {
    const c = await startCheckout('paymob')
    const flat: Record<string, string> = { ...Object.fromEntries(Object.entries(fullTx(paymobTx(c.pay!))).map(([k, v]) => [k, typeof v === 'object' ? '' : String(v)])), order_id: String(c.pay!.provider_order_id), 'source_data.pan': '2346', 'source_data.sub_type': 'MasterCard', 'source_data.type': 'card', merchant_order_id: c.pay!.reference }
    const hmac = createHmac('sha512', SECRETS.testHmac).update(getFields(flat)).digest('hex')
    const forged = await fetch(`${BASE}/api/checkout/return/paymob?${new URLSearchParams({ ...flat, hmac: 'f'.repeat(128) })}`, { redirect: 'manual' })
    expect(forged.status).toBe(302)
    expect(await orderCount(c.pay!.id)).toBe(0)
    const real = await fetch(`${BASE}/api/checkout/return/paymob?${new URLSearchParams({ ...flat, hmac })}`, { redirect: 'manual' })
    expect(real.status).toBe(302)
    expect(real.headers.get('location')).toBe(`/checkout/return?reference=${c.pay!.reference}`)
    expect(await orderCount(c.pay!.id)).toBe(1)
  })
})

// ---- Tap ----------------------------------------------------------------------------------------------------------------------------------------
describe('Tap: session and settlement', () => {
  it('creates a hosted-page charge from database prices and stores the charge id for binding', async () => {
    const c = await startCheckout('tap', { total: 0.01 })
    expect(c.res.status).toBe(200)
    expect(c.body.redirectUrl).toBe('https://checkout.payments.tap.company/mock')
    expect(c.pay!.provider_order_id).toMatch(/^chg_MOCK/)
    const charge = mock.tapCharges.get(c.pay!.provider_order_id!)!
    expect(Number(charge.amount)).toBeCloseTo(c.book.price, 2)
    expect(mock.tapAuth.at(-1)).toBe(`Bearer ${SECRETS.tapTest}`)
  })
  it('settles from the API: the webhook is verified, the charge is re-fetched, an order is created once, and replays are duplicates', async () => {
    const c = await startCheckout('tap')
    const id = c.pay!.provider_order_id!
    const charge = mock.tapCharges.get(id)!
    Object.assign(charge, { status: 'CAPTURED', response: { code: '000', message: 'Captured' }, reference: { ...(charge.reference as object), gateway: 'gw1', payment: 'pay1' } })
    const first = await postTap(charge)
    expect(first.status).toBe(200)
    const f = await first.json()
    expect(f).toMatchObject({ ok: true, duplicate: false })
    expect(await postTap(charge).then((r) => r.json())).toMatchObject({ duplicate: true, orderId: f.orderId })
    const burst = await Promise.all(Array.from({ length: 8 }, () => postTap(charge).then((r) => r.json())))
    expect(burst.every((r) => r.orderId === f.orderId)).toBe(true)
    expect(await orderCount(c.pay!.id)).toBe(1)
  })
  it('a webhook claiming CAPTURED while Tap\'s API says DECLINED fails the payment: the API wins', async () => {
    const c = await startCheckout('tap')
    const charge = mock.tapCharges.get(c.pay!.provider_order_id!)!
    const claim = { ...charge, status: 'CAPTURED' }
    Object.assign(charge, { status: 'DECLINED', response: { code: '501', message: 'Declined' } })
    const r = await postTap(claim)
    expect((await r.json()).outcome).toBe('failed')
    expect(await orderCount(c.pay!.id)).toBe(0)
    expect((await payRow(c.pay!.id)).status).toBe('failed')
  })
  it('a webhook with a low amount cannot settle for less: Tap\'s API amount is what is compared with the stored payment', async () => {
    const c = await startCheckout('tap')
    const charge = mock.tapCharges.get(c.pay!.provider_order_id!)!
    const lie = { ...charge, status: 'CAPTURED', amount: 0.01 }
    Object.assign(charge, { status: 'CAPTURED', amount: Number(charge.amount) })
    const r = await postTap(lie)
    expect(typeof (await r.json()).orderId).toBe('string')
    expect(await orderCount(c.pay!.id)).toBe(1) // settled at the real amount, never at the claimed one
    expect((await svc.from('orders').select('total_amount').eq('payment_id', c.pay!.id).single()).data?.total_amount).toBe(c.pay!.amount)
    const other = await startCheckout('tap')
    const oc = mock.tapCharges.get(other.pay!.provider_order_id!)!
    Object.assign(oc, { status: 'CAPTURED', amount: 0.5 }) // Tap itself reports a different amount than we asked for
    const mism = await postTap({ ...oc })
    expect((await mism.json()).outcome).toBe('needs_review')
    expect(await orderCount(other.pay!.id)).toBe(0)
    expect((await payRow(other.pay!.id)).needs_review).toBe(true)
  })
  it('rejects a missing or wrong hashstring (401), and a live-key signature cannot settle a test payment', async () => {
    const c = await startCheckout('tap')
    const charge = mock.tapCharges.get(c.pay!.provider_order_id!)!
    Object.assign(charge, { status: 'CAPTURED' })
    expect((await fetch(`${BASE}/api/webhooks/payments/tap`, { method: 'POST', body: JSON.stringify(charge) })).status).toBe(401)
    expect((await postTap(charge, 'a-secret-nobody-configured')).status).toBe(401)
    mock.tapAuth.length = 0
    const live = await postTap(charge, SECRETS.tapLive)
    expect(live.status === 200 || live.status === 502).toBe(true)
    expect(await orderCount(c.pay!.id)).toBe(0) // never settled by the live key set
  })
  it('an unknown charge id is 404 / refused and settles nothing', async () => {
    const ghost = { id: 'chg_GHOSTNOTISSUED123', status: 'CAPTURED', amount: 5, currency: 'USD', reference: { order: randomUUID() }, transaction: { created: '1' } }
    expect([404, 502]).toContain((await postTap(ghost)).status)
  })
  it('browser return: Tap\'s charge is re-fetched for tap_id and settles; an unverifiable return only redirects', async () => {
    const c = await startCheckout('tap')
    const id = c.pay!.provider_order_id!
    const unpaid = await fetch(`${BASE}/api/checkout/return/tap?tap_id=${id}&reference=${c.pay!.reference}`, { redirect: 'manual' })
    expect(unpaid.status).toBe(302)
    expect(await orderCount(c.pay!.id)).toBe(0) // still INITIATED at Tap
    Object.assign(mock.tapCharges.get(id)!, { status: 'CAPTURED' })
    const paid = await fetch(`${BASE}/api/checkout/return/tap?tap_id=${id}&reference=${c.pay!.reference}`, { redirect: 'manual' })
    expect(paid.headers.get('location')).toBe(`/checkout/return?reference=${c.pay!.reference}`)
    expect(await orderCount(c.pay!.id)).toBe(1)
    const junk = await fetch(`${BASE}/api/checkout/return/tap?tap_id=chg_UNKNOWNCHARGE999`, { redirect: 'manual' })
    expect(junk.status).toBe(302)
  })
})

describe('admin reconciliation of a missed webhook', () => {
  it('Tap: a pending payment is checked against the gateway API and settled once; checking again changes nothing; Paymob is refused honestly; customers are refused', async () => {
    const c = await startCheckout('tap')
    const id = c.pay!.provider_order_id!
    const admin = await apiAs('admin@aawraq.test', BASE)
    const stillOpen = await (await admin(`/api/admin/payments/${c.pay!.id}/recheck`, { method: 'POST' })).json()
    expect(stillOpen).toMatchObject({ status: 'pending', outcome: 'pending' })
    Object.assign(mock.tapCharges.get(id)!, { status: 'CAPTURED' })
    const settled = await (await admin(`/api/admin/payments/${c.pay!.id}/recheck`, { method: 'POST' })).json()
    expect(settled).toMatchObject({ status: 'succeeded', outcome: 'fulfilled' })
    expect(await (await admin(`/api/admin/payments/${c.pay!.id}/recheck`, { method: 'POST' })).json()).toMatchObject({ status: 'succeeded', outcome: 'unchanged' })
    expect(await orderCount(c.pay!.id)).toBe(1)
    const pm = await startCheckout('paymob')
    expect((await admin(`/api/admin/payments/${pm.pay!.id}/recheck`, { method: 'POST' })).status).toBe(409)
    expect((await c.api(`/api/admin/payments/${c.pay!.id}/recheck`, { method: 'POST' })).status).toBe(403)
    expect((await admin('/api/admin/payments/not-a-uuid/recheck', { method: 'POST' })).status).toBe(400)
  })
})

describe('guards', () => {
  it('unknown providers are 404 and the simulator webhook is refused when it is not enabled', async () => {
    expect((await fetch(`${BASE}/api/webhooks/payments/stripe`, { method: 'POST', body: '{}' })).status).toBe(404)
    expect([401, 403, 404]).toContain((await fetch(`${BASE}/api/webhooks/payments/dev_simulator`, { method: 'POST', body: '{}' })).status) // never 200
  })
  it('oversized webhook bodies are refused', async () => {
    const r = await fetch(`${BASE}/api/webhooks/payments/paymob?hmac=${'a'.repeat(128)}`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '70000' }, body: 'x'.repeat(70_000) })
    expect([400, 413]).toContain(r.status)
  })
})
