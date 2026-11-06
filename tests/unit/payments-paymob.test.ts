// Paymob contract tests. No network: the gateway is a mock. Anchored to the OFFICIAL worked example in the HMAC Transaction Callback docs.
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { classify, createPaymob, getFields, hmacMatches, postFields } from '../../server/services/payments/paymob'
import type { FetchLike, GatewayRuntime } from '../../server/services/payments/types'

const REF = '3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f607'
// Sample processed (POST) transaction from the Paymob docs (abridged to the fields that matter).
const docTx = () => ({
  id: 192036465, amount_cents: 100000, created_at: '2024-06-13T11:33:44.592345', currency: 'EGP', error_occured: false, has_parent_transaction: false,
  integration_id: 4097558, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  owner: 302852, pending: false, success: true, order: { id: 217503754, merchant_order_id: null }, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
})
const DOC_STRING = '1000002024-06-13T11:33:44.592345EGPfalsefalse1920364654097558truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue'

const runtime = (over: Record<string, unknown> = {}): GatewayRuntime => ({
  paymentsEnabledProviders: 'paymob,tap', paymentsLiveEnabled: false, paymobCurrency: 'USD', // the owner has confirmed the integration charges in USD
  paymobTestSecretKey: 'sk_test_x', paymobTestPublicKey: 'pk_test_x', paymobTestHmacSecret: 'test-hmac', paymobTestIntegrationIds: '1256, 1257',
  paymobLiveSecretKey: 'sk_live_x', paymobLivePublicKey: 'pk_live_x', paymobLiveHmacSecret: 'live-hmac', paymobLiveIntegrationIds: '9001',
  ...over,
})
const settings = (over = {}) => ({ allow_test_payments: true, payment_mode: 'test' as const, base_currency: 'USD', ...over })
const sign = (tx: object, secret: string) => createHmac('sha512', secret).update(postFields(tx)).digest('hex')
const body = (tx: object, type = 'TRANSACTION') => JSON.stringify({ type, obj: tx })
const failure = (fn: () => unknown) => { try { fn() } catch (e) { return e as { statusCode: number } } return null }
const asyncFailure = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as { statusCode: number } } return null }
const paymob = createPaymob()

describe('HMAC string (official example)', () => {
  it('concatenates the documented 20 fields in the documented order, exactly as the docs print it', () => {
    expect(postFields(docTx())).toBe(DOC_STRING)
  })
  it('the GET (redirect) form uses the flat keys id and order_id and yields the same string', () => {
    const q = Object.fromEntries(Object.entries({ ...docTx(), order_id: 217503754, 'source_data.pan': '2346', 'source_data.sub_type': 'MasterCard', 'source_data.type': 'card' }).map(([k, v]) => [k, String(v)]))
    expect(getFields(q)).toBe(DOC_STRING)
  })
  it('compares in constant time and rejects wrong, short and non-hex values', () => {
    const good = sign(docTx(), 'k')
    expect(hmacMatches(DOC_STRING, good, 'k')).toBe(true)
    expect(hmacMatches(DOC_STRING, good.toUpperCase(), 'k')).toBe(true)
    expect(hmacMatches(DOC_STRING, good, 'other')).toBe(false)
    expect(hmacMatches(DOC_STRING, good.slice(2), 'k')).toBe(false)
    expect(hmacMatches(DOC_STRING, 'zz', 'k')).toBe(false)
  })
})

describe('webhook verification', () => {
  const tx = () => ({ ...docTx(), currency: 'USD', order: { id: 555, merchant_order_id: REF } })
  it('accepts a correctly signed success, binds it to the signed order id, and reports which key set signed it', () => {
    const t = tx()
    const e = paymob.parseWebhook(body(t), {}, { hmac: sign(t, 'test-hmac') }, runtime())
    expect(e).toMatchObject({ status: 'succeeded', keyMode: 'test', providerOrderId: '555', reference: REF, amount: 1000, currency: 'USD', providerTransactionId: '192036465' })
    expect(e.reversal).toBe(false)
  })
  it('a live-key signature is reported as live, so a test payment can never be settled by it', () => {
    const t = tx()
    expect(paymob.parseWebhook(body(t), {}, { hmac: sign(t, 'live-hmac') }, runtime()).keyMode).toBe('live')
  })
  it('rejects a missing, malformed, wrong or tampered signature with 401', () => {
    const t = tx()
    for (const hmac of [undefined, '', 'abc', sign(t, 'not-the-secret')]) {
      expect(failure(() => paymob.parseWebhook(body(t), {}, { hmac }, runtime()))?.statusCode).toBe(401)
    }
    const tampered = { ...t, amount_cents: 1 } // an attacker lowers the price after capture
    expect(failure(() => paymob.parseWebhook(body(tampered), {}, { hmac: sign(t, 'test-hmac') }, runtime()))?.statusCode).toBe(401)
    const otherOrder = { ...t, order: { id: 999, merchant_order_id: REF } } // replaying a valid event against a different order
    expect(failure(() => paymob.parseWebhook(body(otherOrder), {}, { hmac: sign(t, 'test-hmac') }, runtime()))?.statusCode).toBe(401)
  })
  it('refuses everything when no HMAC secret is configured (fail closed)', () => {
    const t = tx()
    expect(failure(() => paymob.parseWebhook(body(t), {}, { hmac: sign(t, 'test-hmac') }, {}))?.statusCode).toBe(401)
  })
  it('acknowledges a card-token callback without treating it as a payment', () => {
    const e = paymob.parseWebhook(JSON.stringify({ type: 'TOKEN', obj: { token: 'x' } }), {}, {}, runtime())
    expect(e).toMatchObject({ status: 'pending', providerOrderId: null, reference: null })
  })
  it('rejects malformed JSON and a payload without a transaction', () => {
    expect(failure(() => paymob.parseWebhook('{nope', {}, {}, runtime()))?.statusCode).toBe(400)
    expect(failure(() => paymob.parseWebhook('{"type":"TRANSACTION"}', {}, { hmac: 'a'.repeat(128) }, runtime()))?.statusCode).toBe(400)
  })
  it('never stores card digits, billing or customer data: the raw subset is whitelisted', () => {
    const t = { ...tx(), billing_data: { email: 'a@b.c', phone_number: '+9665' }, data: { card_num: '2346' }, payment_key_claims: { billing_data: { email: 'a@b.c' } } }
    const e = paymob.parseWebhook(body(t), {}, { hmac: sign(t, 'test-hmac') }, runtime())
    const dump = JSON.stringify(e.raw)
    expect(dump).not.toMatch(/2346|a@b\.c|phone|billing|pan/)
    expect(e.raw).toMatchObject({ id: 192036465, amount_cents: 100000, order_id: 555, source_type: 'card' })
  })
})

describe('success rules', () => {
  const base = { success: true, pending: false, is_voided: false, is_refunded: false, error_occured: false, is_auth: false, is_capture: false }
  it.each([
    [base, 'succeeded', false],
    [{ ...base, success: false }, 'failed', false],
    [{ ...base, pending: true }, 'pending', false],
    [{ ...base, is_auth: true, is_capture: false }, 'pending', false], // authorised only: not money yet
    [{ ...base, is_auth: true, is_capture: true }, 'succeeded', false],
    [{ ...base, error_occured: true }, 'failed', false],
    [{ ...base, is_voided: true }, 'failed', true],
    [{ ...base, is_refunded: true }, 'failed', true],
    [{ ...base, success: 'true' }, 'succeeded', false], // GET callbacks carry strings
  ])('%j -> %s (reversal %s)', (o, status, reversal) => {
    expect(classify(o)).toEqual({ status, reversal })
  })
})

describe('createSession', () => {
  const req = {
    payment: { id: 'p1', reference: REF, amount: 21.5, currency: 'USD', mode: 'test' as const },
    items: [{ name: 'كتاب أول', amount: 12 }, { name: 'Book two', amount: 9.5 }],
    customer: { name: 'Sara Ali', email: 'sara@example.invalid', phone: null },
    urls: { webhook: 'https://shop.example.invalid/api/webhooks/payments/paymob', redirect: 'https://shop.example.invalid/api/checkout/return/paymob?reference=' + REF },
  }
  const gateway = (reply: { ok?: boolean; json?: unknown } = {}) => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
    const fetchImpl: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok: reply.ok ?? true, status: reply.ok === false ? 400 : 201, json: async () => reply.json ?? { client_secret: 'cs_123', intention_order_id: 777, id: 'int_1' } } }
    return { calls, provider: createPaymob(fetchImpl) }
  }

  it('posts a server-priced intention with the documented fields and returns the hosted checkout URL plus the gateway order id', async () => {
    const { calls, provider } = gateway()
    const r = await provider.createSession(req, runtime())
    expect(r).toEqual({ redirectUrl: 'https://ksa.checkout.paymob.com/?publicKey=pk_test_x&clientSecret=cs_123', providerOrderId: '777' })
    const c = calls[0]!
    expect(c.url).toBe('https://ksa.paymob.com/v1/intention/')
    expect(c.init.method).toBe('POST')
    expect(c.init.headers.authorization).toBe('Token sk_test_x')
    const sent = JSON.parse(c.init.body!)
    expect(sent).toMatchObject({ amount: 2150, currency: 'USD', payment_methods: [1256, 1257], special_reference: REF, notification_url: req.urls.webhook, redirection_url: req.urls.redirect, extras: { reference: REF } })
    expect(sent.items.map((i: { amount: number }) => i.amount)).toEqual([1200, 950])
    expect(sent.items.reduce((s: number, i: { amount: number }) => s + i.amount, 0)).toBe(sent.amount)
    expect(sent.billing_data).toMatchObject({ first_name: 'Sara', last_name: 'Ali', email: 'sara@example.invalid', country: 'SA' })
    expect(sent.billing_data.phone_number).toBeTruthy()
  })
  it('uses the LIVE key set for a live payment and never the test one', async () => {
    const { calls, provider } = gateway()
    await provider.createSession({ ...req, payment: { ...req.payment, mode: 'live' } }, runtime())
    expect(calls[0]!.init.headers.authorization).toBe('Token sk_live_x')
    expect(JSON.parse(calls[0]!.init.body!).payment_methods).toEqual([9001])
  })
  it('refuses a session whose gateway answer cannot be bound to the payment (no order id, no client secret) and a failing gateway, without leaking details', async () => {
    for (const reply of [{ json: { client_secret: 'cs' } }, { json: { intention_order_id: 1 } }, { ok: false, json: { detail: 'secret internal message' } }]) {
      const err = await asyncFailure(() => gateway(reply).provider.createSession(req, runtime()))
      expect(err?.statusCode).toBe(502)
      expect(JSON.stringify(err)).not.toContain('secret internal message')
    }
  })
  it('refuses to send items that do not add up to the amount', async () => {
    const err = await asyncFailure(() => gateway().provider.createSession({ ...req, items: [{ name: 'x', amount: 5 }] }, runtime()))
    expect(err?.statusCode).toBe(500)
  })
  it('refuses when the key set for the payment mode is not configured', async () => {
    const err = await asyncFailure(() => gateway().provider.createSession(req, runtime({ paymobTestSecretKey: '' })))
    expect(err?.statusCode).toBe(503)
  })
})

describe('availability and status (nothing live without two explicit owner switches)', () => {
  it('is unavailable when not configured, and the status lists variable NAMES only', () => {
    const s = paymob.status(settings(), { paymentsEnabledProviders: 'paymob' })
    expect(s.available).toBe(false)
    expect(s.missing).toEqual(['NUXT_PAYMOB_TEST_SECRET_KEY', 'NUXT_PAYMOB_TEST_PUBLIC_KEY', 'NUXT_PAYMOB_TEST_HMAC_SECRET', 'NUXT_PAYMOB_TEST_INTEGRATION_IDS'])
    expect(failure(() => paymob.assertAvailable(settings(), { paymentsEnabledProviders: 'paymob' }))?.statusCode).toBe(503)
  })
  it('test mode is available when configured and test payments are allowed; the status never contains a secret value', () => {
    const s = paymob.status(settings(), runtime())
    expect(s).toMatchObject({ available: true, configured: true, mode: 'test', verified: false })
    expect(JSON.stringify(s)).not.toMatch(/sk_test_x|pk_test_x|test-hmac/)
    expect(paymob.status(settings({ allow_test_payments: false }), runtime()).available).toBe(false)
  })
  it('live needs NUXT_PAYMENTS_LIVE_ENABLED AND the provider attested as verified; otherwise it is refused', () => {
    const live = settings({ payment_mode: 'live' })
    expect(paymob.status(live, runtime()).reason).toMatch(/live payments are disabled/)
    expect(paymob.status(live, runtime({ paymentsLiveEnabled: true })).reason).toMatch(/NOT VERIFIED/)
    expect(paymob.status(live, runtime({ paymentsLiveEnabled: true, paymobVerified: true })).available).toBe(true)
  })
  it('refuses when the gateway currency differs from the store currency: no conversion is ever applied', () => {
    const s = paymob.status(settings(), runtime({ paymobCurrency: 'SAR' }))
    expect(s.available).toBe(false)
    expect(s.currency).toMatchObject({ store: 'USD', gateway: 'SAR', matches: false, confirmed: true })
    expect(paymob.status(settings({ base_currency: 'SAR' }), runtime({ paymobCurrency: 'sar' })).currency.matches).toBe(true)
  })
  it('is unavailable when the provider is not enabled', () => {
    expect(paymob.status(settings(), runtime({ paymentsEnabledProviders: 'tap' })).available).toBe(false)
  })
})

describe('currency confirmation and regions (nothing is assumed, nothing is converted)', () => {
  it('is UNAVAILABLE until the owner confirms the account currency, even with every credential present, and says exactly which variable to set', () => {
    const s = paymob.status(settings(), runtime({ paymobCurrency: '' }))
    expect(s.available).toBe(false)
    expect(s.reason).toMatch(/NUXT_PAYMOB_CURRENCY/)
    expect(s.reason).toMatch(/store currency USD/)
    expect(s.currency).toMatchObject({ confirmed: false, matches: false, gateway: 'not confirmed' })
    expect(s.currency.note).toMatch(/does not list which currencies a regional account can charge/)
    expect(failure(() => paymob.assertAvailable(settings(), runtime({ paymobCurrency: '' })))?.statusCode).toBe(503)
  })
  it('a confirmed currency that differs from the store currency is refused, and one that equals it is accepted (case-insensitive)', () => {
    expect(paymob.status(settings(), runtime({ paymobCurrency: 'SAR' })).reason).toMatch(/differs from the store currency USD/)
    expect(paymob.status(settings(), runtime({ paymobCurrency: 'usd' })).available).toBe(true)
  })
  it('the regional account decides the hosts: KSA by default (the legacy store), Egypt, UAE and Oman from the docs, and an unknown region is refused', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async (url) => { calls.push(url); return { ok: true, status: 201, json: async () => ({ client_secret: 'cs', intention_order_id: 5 }) } }
    const req = { payment: { id: 'p', reference: REF, amount: 5, currency: 'USD', mode: 'test' as const }, items: [{ name: 'b', amount: 5 }], customer: { name: 'A B', email: 'a@b.invalid', phone: null }, urls: { webhook: 'https://x.invalid/w', redirect: 'https://x.invalid/r' } }
    const hosts: [string | undefined, string, string][] = [[undefined, 'https://ksa.paymob.com/v1/intention/', 'https://ksa.checkout.paymob.com'], ['egypt', 'https://accept.paymob.com/v1/intention/', 'https://eg.checkout.paymob.com'], ['uae', 'https://uae.paymob.com/v1/intention/', 'https://uae.checkout.paymob.com'], ['oman', 'https://oman.paymob.com/v1/intention/', 'https://om.checkout.paymob.com']]
    for (const [region, intention, checkout] of hosts) {
      const r = await createPaymob(fetchImpl).createSession(req, runtime(region ? { paymobRegion: region } : {}))
      expect(calls.at(-1)).toBe(intention)
      expect(r.redirectUrl.startsWith(checkout + '/?publicKey=')).toBe(true)
    }
    expect(paymob.status(settings(), runtime({ paymobRegion: 'mars' })).reason).toMatch(/NUXT_PAYMOB_REGION/)
    expect((await asyncFailure(() => createPaymob(fetchImpl).createSession(req, runtime({ paymobRegion: 'mars' }))))?.statusCode).toBe(503)
    expect(paymob.status(settings(), runtime({ paymobRegion: 'UAE' })).region).toBe('uae')
  })
  it('explicit URLs still override the region (sandbox mocks, proxies)', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async (url) => { calls.push(url); return { ok: true, status: 201, json: async () => ({ client_secret: 'cs', intention_order_id: 5 }) } }
    const req = { payment: { id: 'p', reference: REF, amount: 5, currency: 'USD', mode: 'test' as const }, items: [{ name: 'b', amount: 5 }], customer: { name: 'A B', email: 'a@b.invalid', phone: null }, urls: { webhook: 'https://x.invalid/w', redirect: 'https://x.invalid/r' } }
    await createPaymob(fetchImpl).createSession(req, runtime({ paymobBaseUrl: 'https://proxy.example.invalid' }))
    expect(calls[0]).toBe('https://proxy.example.invalid/v1/intention/')
  })
})

describe('browser return verification', () => {
  const q = (secret: string, over: Record<string, string> = {}) => {
    const flat = { ...Object.fromEntries(Object.entries({ ...docTx(), currency: 'USD', order_id: 555 }).map(([k, v]) => [k, typeof v === 'object' ? '' : String(v)])), 'source_data.pan': '2346', 'source_data.sub_type': 'MasterCard', 'source_data.type': 'card', merchant_order_id: REF, ...over }
    return { ...flat, hmac: createHmac('sha512', secret).update(getFields(flat)).digest('hex') }
  }
  it('accepts a correctly signed redirect and returns an event; rejects a forged one (the page then just waits for the webhook)', async () => {
    const ok = await paymob.verifyReturn!(q('test-hmac'), runtime(), ['test'])
    expect(ok).toMatchObject({ status: 'succeeded', providerOrderId: '555', keyMode: 'test', reference: REF })
    expect(await paymob.verifyReturn!({ ...q('test-hmac'), success: 'false' }, runtime(), ['test'])).toBeNull()
    expect(await paymob.verifyReturn!(q('wrong'), runtime(), ['test'])).toBeNull()
    expect(await paymob.verifyReturn!(q('live-hmac'), runtime(), ['test'])).toBeNull() // a live signature is not accepted for a test payment
  })
})

describe('environment values that Nuxt parses as numbers', () => {
  it('a single integration id (9001) and an all-digit secret are read, not dropped', () => {
    const rt = { ...runtime(), paymobLiveIntegrationIds: 9001, paymobLiveHmacSecret: 12345678 }
    const s = paymob.status(settings({ payment_mode: 'live' }), { ...rt, paymentsLiveEnabled: true, paymobVerified: true })
    expect(s.missing).toEqual([])
    expect(s.available).toBe(true)
  })
})
