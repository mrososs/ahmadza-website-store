// Tap contract tests. No network: the gateway is a mock. The signature layout follows Tap's Webhook documentation (hashstring, HMAC-SHA256).
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { amountVariants, createTap, hashstringMatches, mapStatus, tapDecimals, tapSignedString } from '../../server/services/payments/tap'
import type { FetchLike, GatewayRuntime } from '../../server/services/payments/types'

const REF = '3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f607'
const CHG = 'chg_TS012520220955Rr950709475'
const runtime = (over: Record<string, unknown> = {}): GatewayRuntime => ({
  paymentsEnabledProviders: 'paymob,tap', paymentsLiveEnabled: false, tapCurrency: 'USD', tapTestSecretKey: 'sk_test_tap', tapLiveSecretKey: 'sk_live_tap', ...over,
})
const settings = (over = {}) => ({ allow_test_payments: true, payment_mode: 'test' as const, base_currency: 'USD', ...over })
const charge = (over: Record<string, unknown> = {}) => ({
  id: CHG, object: 'charge', status: 'CAPTURED', amount: 21.5, currency: 'USD', reference: { transaction: REF, order: REF, gateway: 'gw123', payment: 'pay456' },
  transaction: { created: '1668000000000', url: 'https://checkout.payments.tap.company?mode=page&token=abc' }, metadata: { reference: REF },
  response: { code: '000', message: 'Captured' }, customer: { first_name: 'Sara', email: 'sara@example.invalid', phone: { number: '555' } }, source: { id: 'src_card', payment_method: 'VISA', last_four: '4242' },
  ...over,
})
const sign = (c: object, secret: string, amount?: string) => createHmac('sha256', secret).update(tapSignedString(c, amount ?? (c as { amount: number }).amount.toFixed(2))).digest('hex')
const failure = (fn: () => unknown) => { try { fn() } catch (e) { return e as { statusCode: number } } return null }
const asyncFailure = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { return e as { statusCode: number } } return null }
const tap = createTap()

describe('hashstring', () => {
  it('signs the documented x_ string: id, amount, currency, gateway reference, payment reference, status, created', () => {
    expect(tapSignedString(charge(), '21.50')).toBe(`x_id${CHG}x_amount21.50x_currencyUSDx_gateway_referencegw123x_payment_referencepay456x_statusCAPTURED` + 'x_created1668000000000')
  })
  it('an absent gateway reference is passed as an empty value', () => {
    expect(tapSignedString(charge({ reference: { order: REF } }), '1.00')).toContain('x_gateway_referencex_payment_referencex_status')
  })
  it('accepts the amount as fixed decimals, as a JSON number or as the exact text, since the docs do not fix the form', () => {
    const c = charge()
    const rawBody = JSON.stringify(c).replace('"amount":21.5', '"amount":21.500')
    expect(amountVariants(c, rawBody)).toEqual(expect.arrayContaining(['21.50', '21.5', '21.500']))
    for (const a of ['21.50', '21.5', '21.500']) expect(hashstringMatches(c, rawBody, sign(c, 'k', a), 'k')).toBe(true)
    expect(hashstringMatches(c, rawBody, sign(c, 'k', '99.00'), 'k')).toBe(false)
    expect(hashstringMatches(c, rawBody, sign(c, 'other'), 'k')).toBe(false)
  })
  it('knows the decimal places per currency', () => {
    expect(tapDecimals('sar')).toBe(2)
    expect(tapDecimals('KWD')).toBe(3)
    expect(tapDecimals('XXX')).toBe(2)
  })
})

describe('status mapping', () => {
  it.each([['CAPTURED', 'succeeded', false], ['INITIATED', 'pending', false], ['DECLINED', 'failed', false], ['CANCELLED', 'failed', false], ['ABANDONED', 'failed', false],
    ['FAILED', 'failed', false], ['TIMEDOUT', 'failed', false], ['RESTRICTED', 'failed', false], ['UNKNOWN', 'failed', false], ['VOID', 'failed', true], ['SOMETHING_NEW', 'failed', false]])(
    '%s -> %s', (st, status, reversal) => { expect(mapStatus(st)).toEqual({ status, reversal }) })
})

describe('webhook verification', () => {
  const post = (c: object, secret = 'sk_test_tap') => { const raw = JSON.stringify(c); return { raw, headers: { hashstring: sign(c, secret) } } }
  it('accepts a correctly signed webhook and reports the key set that signed it', () => {
    const { raw, headers } = post(charge())
    expect(tap.parseWebhook(raw, headers, {}, runtime())).toMatchObject({ status: 'succeeded', keyMode: 'test', providerOrderId: CHG, reference: REF, amount: 21.5, currency: 'USD' })
    const live = post(charge(), 'sk_live_tap')
    expect(tap.parseWebhook(live.raw, live.headers, {}, runtime()).keyMode).toBe('live')
  })
  it('rejects a missing, wrong, truncated or tampered signature with 401', () => {
    const c = charge()
    const { raw } = post(c)
    for (const hashstring of [undefined, '', 'abcd', sign(c, 'wrong')]) expect(failure(() => tap.parseWebhook(raw, { hashstring }, {}, runtime()))?.statusCode).toBe(401)
    const tampered = JSON.stringify(charge({ amount: 1 }))
    expect(failure(() => tap.parseWebhook(tampered, { hashstring: sign(c, 'sk_test_tap') }, {}, runtime()))?.statusCode).toBe(401)
    expect(failure(() => tap.parseWebhook(raw, { hashstring: sign(c, 'sk_test_tap') }, {}, {}))?.statusCode).toBe(401) // no keys configured: fail closed
  })
  it('acknowledges non-charge objects (authorize, token) without treating them as payments', () => {
    const e = tap.parseWebhook(JSON.stringify({ id: 'auth_abc', status: 'AUTHORIZED' }), {}, {}, runtime())
    expect(e).toMatchObject({ status: 'pending', providerOrderId: null })
  })
  it('rejects malformed JSON', () => { expect(failure(() => tap.parseWebhook('{nope', {}, {}, runtime()))?.statusCode).toBe(400) })
  it('never stores customer, card or phone data from a charge', () => {
    const { raw, headers } = post(charge())
    const dump = JSON.stringify(tap.parseWebhook(raw, headers, {}, runtime()).raw)
    expect(dump).not.toMatch(/sara@|555|4242|VISA|first_name|customer/)
    expect(dump).toContain(CHG)
  })
})

describe('server-to-server confirmation (the webhook body is only a hint)', () => {
  const gateway = (reply: unknown, ok = true) => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
    const fetchImpl: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok, status: ok ? 200 : 404, json: async () => reply } }
    return { calls, provider: createTap(fetchImpl) }
  }
  const hint = () => { const c = charge(); return tap.parseWebhook(JSON.stringify(c), { hashstring: sign(c, 'sk_test_tap') }, {}, runtime()) }

  it('re-fetches the charge with the secret key of the SAME key set and builds the event from the API answer', async () => {
    const { calls, provider } = gateway(charge({ amount: 21.5 }))
    const e = await provider.confirm!(hint(), runtime())
    expect(calls[0]!.url).toBe(`https://api.tap.company/v2/charges/${CHG}`)
    expect(calls[0]!.init.method).toBe('GET')
    expect(calls[0]!.init.headers.authorization).toBe('Bearer sk_test_tap')
    expect(e).toMatchObject({ status: 'succeeded', amount: 21.5, providerOrderId: CHG, reference: REF })
  })
  it('a webhook that claims CAPTURED while the API says DECLINED settles as failed: the API wins', async () => {
    const { provider } = gateway(charge({ status: 'DECLINED' }))
    expect((await provider.confirm!(hint(), runtime())).status).toBe('failed')
  })
  it('a webhook that claims a low amount while the API reports the real one uses the API amount', async () => {
    const { provider } = gateway(charge({ amount: 300 }))
    expect((await provider.confirm!(hint(), runtime())).amount).toBe(300)
  })
  it('refuses when the API returns a different charge or cannot be reached', async () => {
    expect((await asyncFailure(() => gateway(charge({ id: 'chg_SOMEONEELSE123' })).provider.confirm!(hint(), runtime())))?.statusCode).toBe(502)
    expect((await asyncFailure(() => gateway({}, false).provider.confirm!(hint(), runtime())))?.statusCode).toBe(502)
  })
})

describe('createSession', () => {
  const req = {
    payment: { id: 'p1', reference: REF, amount: 21.5, currency: 'USD', mode: 'test' as const },
    items: [{ name: 'Book', amount: 21.5 }], customer: { name: 'Sara Ali', email: 'sara@example.invalid', phone: null },
    urls: { webhook: 'https://shop.example.invalid/api/webhooks/payments/tap', redirect: 'https://shop.example.invalid/api/checkout/return/tap?reference=' + REF },
  }
  const gateway = (reply: unknown = { id: CHG, status: 'INITIATED', transaction: { url: 'https://checkout.payments.tap.company?mode=page&token=abc' } }, ok = true) => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
    const fetchImpl: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok, status: ok ? 200 : 400, json: async () => reply } }
    return { calls, provider: createTap(fetchImpl) }
  }
  it('creates a hosted-page charge (src_all) from server values and returns the Tap page URL and the charge id', async () => {
    const { calls, provider } = gateway()
    const r = await provider.createSession(req, runtime())
    expect(r).toEqual({ redirectUrl: 'https://checkout.payments.tap.company?mode=page&token=abc', providerOrderId: CHG })
    expect(calls[0]!.url).toBe('https://api.tap.company/v2/charges')
    expect(calls[0]!.init.headers.authorization).toBe('Bearer sk_test_tap')
    const sent = JSON.parse(calls[0]!.init.body!)
    expect(sent).toMatchObject({ amount: 21.5, currency: 'USD', source: { id: 'src_all' }, threeDSecure: true, save_card: false, reference: { transaction: REF, order: REF }, metadata: { reference: REF }, post: { url: req.urls.webhook }, redirect: { url: req.urls.redirect }, customer: { first_name: 'Sara', email: 'sara@example.invalid' } })
    expect(JSON.stringify(sent)).not.toMatch(/card_number|cvv|"number"/) // no card data ever passes through this app
  })
  it('rounds the amount to the currency decimals (KWD three, USD two)', async () => {
    const { calls, provider } = gateway()
    await provider.createSession({ ...req, payment: { ...req.payment, amount: 1.005, currency: 'KWD' } }, runtime())
    expect(JSON.parse(calls[0]!.init.body!).amount).toBe(1.005)
    await provider.createSession({ ...req, payment: { ...req.payment, amount: 10.1 } }, runtime())
    expect(JSON.parse(calls[1]!.init.body!).amount).toBe(10.1)
  })
  it('only ever sends the browser to a Tap-owned https page, and refuses an incomplete answer or a gateway error without leaking it', async () => {
    for (const reply of [{ id: CHG, transaction: { url: 'https://evil.example/pay' } }, { id: CHG, transaction: { url: 'http://checkout.payments.tap.company/x' } }, { id: 'nope', transaction: { url: 'https://checkout.payments.tap.company/x' } }, { status: 'INITIATED' }]) {
      expect((await asyncFailure(() => gateway(reply).provider.createSession(req, runtime())))?.statusCode).toBe(502)
    }
    const err = await asyncFailure(() => gateway({ errors: [{ description: 'internal secret text' }] }, false).provider.createSession(req, runtime()))
    expect(err?.statusCode).toBe(502)
    expect(JSON.stringify(err)).not.toContain('internal secret text')
  })
  it('uses the live key for a live payment and the merchant id when configured', async () => {
    const { calls, provider } = gateway()
    await provider.createSession({ ...req, payment: { ...req.payment, mode: 'live' } }, runtime({ tapMerchantId: 'm_1' }))
    expect(calls[0]!.init.headers.authorization).toBe('Bearer sk_live_tap')
    expect(JSON.parse(calls[0]!.init.body!).merchant).toEqual({ id: 'm_1' })
  })
})

describe('availability and status', () => {
  it('is unavailable without a key and reports the variable NAME, never a value', () => {
    const s = tap.status(settings(), { paymentsEnabledProviders: 'tap' })
    expect(s).toMatchObject({ available: false, missing: ['NUXT_TAP_TEST_SECRET_KEY'], verified: false })
    expect(JSON.stringify(tap.status(settings(), runtime()))).not.toContain('sk_test_tap')
  })
  it('live needs the explicit switch and the verified attestation; the currency must match the store with no conversion', () => {
    const live = settings({ payment_mode: 'live' })
    expect(tap.status(live, runtime()).reason).toMatch(/disabled/)
    expect(tap.status(live, runtime({ paymentsLiveEnabled: true })).reason).toMatch(/NOT VERIFIED/)
    expect(tap.status(live, runtime({ paymentsLiveEnabled: true, tapVerified: 'true' })).available).toBe(true)
    expect(tap.status(settings(), runtime({ tapCurrency: 'SAR' })).available).toBe(false)
  })
})

describe('currency confirmation (nothing is assumed, nothing is converted)', () => {
  it('is UNAVAILABLE until the owner confirms the merchant account currency, and names the variable', () => {
    const s = tap.status(settings(), runtime({ tapCurrency: '' }))
    expect(s.available).toBe(false)
    expect(s.reason).toMatch(/NUXT_TAP_CURRENCY/)
    expect(s.currency).toMatchObject({ confirmed: false, matches: false })
    expect(s.currency.note).toMatch(/does not list its supported currencies/)
  })
  it('a confirmed currency must equal the store currency', () => {
    expect(tap.status(settings(), runtime({ tapCurrency: 'KWD' })).reason).toMatch(/differs from the store currency USD/)
    expect(tap.status(settings(), runtime({ tapCurrency: 'usd' })).available).toBe(true)
  })
})

describe('browser return', () => {
  it('re-fetches the charge named by tap_id, trying only the allowed key sets, and gives up quietly when nothing can be proven', async () => {
    const calls: string[] = []
    const fetchImpl: FetchLike = async (_u, init) => { calls.push(init.headers.authorization!); return { ok: true, status: 200, json: async () => charge() } }
    const provider = createTap(fetchImpl)
    expect(await provider.verifyReturn!({ tap_id: CHG }, runtime(), ['test'])).toMatchObject({ status: 'succeeded', keyMode: 'test' })
    expect(calls).toEqual(['Bearer sk_test_tap']) // a test payment never uses the live key
    expect(await provider.verifyReturn!({ tap_id: 'not-a-charge' }, runtime(), ['test'])).toBeNull()
    const down = createTap(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    expect(await down.verifyReturn!({ tap_id: CHG }, runtime(), ['test'])).toBeNull()
  })
})
