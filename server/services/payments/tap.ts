// Tap Payments adapter: provider-hosted checkout (source src_all), so the Nuxt app never touches card data.
// Sources (read 2026-11-06): developers.tap.company  Create a charge; Retrieve a charge; Webhook; Charge statuses.
// Legacy evidence: Tap was the ALTERNATE provider; its callback had no signature check and safety rested on re-fetching the charge and matching
// amount, currency and reference. That pattern is kept, and the documented `hashstring` signature is now checked as well.
// NOT VERIFIED end to end until an authorised sandbox run passes: covered by contract tests only.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { currencyAssurance, httpsBase, refuse, tapKeys, tapMissing, unavailableReason } from './config'
import type { DataMode, FetchLike, GatewayRuntime, ParsedWebhook, PaymentProvider, ProviderStatus, SessionRequest, SessionResult } from './types'

/** Decimal places per currency, from Tap's webhook documentation. */
const DECIMALS: Record<string, number> = { AED: 2, BHD: 3, KWD: 3, OMR: 3, QAR: 2, SAR: 2, USD: 2, EUR: 2, GBP: 2, EGP: 2, JOD: 3 }
export const tapDecimals = (currency: string) => DECIMALS[currency.toUpperCase()] ?? 2

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHARGE_ID = /^chg_[A-Za-z0-9_]{6,80}$/
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o)

export function mapStatus(status: string): { status: ParsedWebhook['status']; reversal: boolean } {
  if (status === 'CAPTURED') return { status: 'succeeded', reversal: false }
  if (status === 'INITIATED') return { status: 'pending', reversal: false }
  return { status: 'failed', reversal: status === 'VOID' }
}

/** The documented signed string: x_id, x_amount, x_currency, x_gateway_reference, x_payment_reference, x_status, x_created, concatenated with no separator. */
export function tapSignedString(c: unknown, amount: string): string {
  return `x_id${s(at(c, 'id'))}x_amount${amount}x_currency${s(at(c, 'currency'))}x_gateway_reference${s(at(c, 'reference.gateway'))}`
    + `x_payment_reference${s(at(c, 'reference.payment'))}x_status${s(at(c, 'status'))}x_created${s(at(c, 'transaction.created'))}`
}

/** The docs do not spell out the textual form of the amount inside the hash, so three representations are accepted: fixed decimals, the JSON number, the exact text. */
export function amountVariants(charge: unknown, rawBody: string): string[] {
  const n = Number(at(charge, 'amount'))
  const textual = /"amount"\s*:\s*("?)([0-9]+(?:\.[0-9]+)?)\1/.exec(rawBody)?.[2]
  return [...new Set([Number.isFinite(n) ? n.toFixed(tapDecimals(s(at(charge, 'currency')))) : '', s(at(charge, 'amount')), textual ?? ''].filter(Boolean))]
}

export function hashstringMatches(charge: unknown, rawBody: string, received: string, secret: string): boolean {
  const given = Buffer.from(received.trim().toLowerCase(), 'hex')
  if (given.length !== 32) return false
  return amountVariants(charge, rawBody).some((a) => {
    const expected = createHmac('sha256', secret).update(tapSignedString(charge, a)).digest()
    return timingSafeEqual(given, expected)
  })
}

const modesWithKeys = (runtime: GatewayRuntime, only?: DataMode[]) => (['test', 'live'] as const).filter((m) => (!only || only.includes(m)) && tapKeys(runtime, m))

/** What we store from a charge: identifiers, status, amount and the gateway's response code. No customer, card or billing data. */
const safeSubset = (c: unknown) => ({
  id: at(c, 'id'), status: at(c, 'status'), amount: at(c, 'amount'), currency: at(c, 'currency'), live_mode: at(c, 'live_mode'),
  reference_order: at(c, 'reference.order'), reference_transaction: at(c, 'reference.transaction'), response_code: at(c, 'response.code'), response_message: at(c, 'response.message'),
  created: at(c, 'transaction.created'), source: at(c, 'source.id'),
})

function eventFromCharge(c: unknown, keyMode: DataMode): ParsedWebhook {
  const id = s(at(c, 'id'))
  const amount = Number(at(c, 'amount'))
  if (!CHARGE_ID.test(id) || !Number.isFinite(amount)) throw createError({ statusCode: 400, statusMessage: 'Invalid webhook payload' })
  const m = mapStatus(s(at(c, 'status')))
  const refRaw = s(at(c, 'reference.order') || at(c, 'reference.transaction') || at(c, 'metadata.reference'))
  return {
    eventId: `${id}:${s(at(c, 'status'))}`, reference: UUID.test(refRaw) ? refRaw.toLowerCase() : null, providerOrderId: id, status: m.status, reversal: m.reversal, keyMode,
    providerTransactionId: id, amount, currency: s(at(c, 'currency')).toUpperCase(), raw: safeSubset(c),
  }
}

export function createTap(fetchImpl: FetchLike = (url, init) => fetch(url, init) as never): PaymentProvider {
  const status = (settings: Parameters<PaymentProvider['status']>[0], runtime: GatewayRuntime): ProviderStatus => {
    const mode = settings.payment_mode
    const missing = tapMissing(runtime, mode)
    const currency = currencyAssurance('Tap', runtime.tapCurrency, settings)
    const verified = runtime.tapVerified === true || String(runtime.tapVerified).toLowerCase() === 'true'
    const reason = unavailableReason({ id: 'tap', runtime, settings, configured: !missing.length, verified, currency, currencyVar: 'NUXT_TAP_CURRENCY' })
    const enabled = String(runtime.paymentsEnabledProviders ?? '').split(',').map((x) => x.trim()).includes('tap')
    return { id: 'tap', label: 'Tap', enabled, configured: !missing.length, missing, mode, liveAllowed: mode === 'live' && !reason, available: !reason, reason, verified, currency }
  }

  async function fetchCharge(id: string, secretKey: string, runtime: GatewayRuntime): Promise<unknown> {
    if (!CHARGE_ID.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid charge id' })
    const base = httpsBase(runtime.tapBaseUrl, 'https://api.tap.company/v2')
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await fetchImpl(`${base}/charges/${id}`, { method: 'GET', headers: { authorization: `Bearer ${secretKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
    } catch { throw createError({ statusCode: 502, statusMessage: 'Payment gateway is unreachable' }) }
    if (!res.ok) throw createError({ statusCode: 502, statusMessage: 'Payment gateway could not confirm the charge' })
    return res.json()
  }

  return {
    id: 'tap',
    label: 'Tap',
    status,
    assertAvailable(settings, runtime) { const r = status(settings, runtime).reason; if (r) refuse(r) },
    mode: (st) => st.payment_mode,

    async createSession(req: SessionRequest, runtime: GatewayRuntime): Promise<SessionResult> {
      const keys = tapKeys(runtime, req.payment.mode)
      if (!keys) refuse(`credentials for ${req.payment.mode} mode are not configured`)
      const base = httpsBase(runtime.tapBaseUrl, 'https://api.tap.company/v2')
      const body: Record<string, unknown> = {
        amount: Number(req.payment.amount.toFixed(tapDecimals(req.payment.currency))),
        currency: req.payment.currency,
        customer_initiated: true,
        threeDSecure: true,
        save_card: false,
        description: 'AAWRAQ order',
        metadata: { reference: req.payment.reference },
        reference: { transaction: req.payment.reference, order: req.payment.reference },
        customer: { first_name: req.customer.name.trim().split(/\s+/)[0] || 'Customer', email: req.customer.email },
        source: { id: 'src_all' }, // Tap's hosted page with every method enabled for the merchant: no card data reaches this app
        transaction: { expiry: { period: 30, type: 'MINUTE' } }, // matches payments.expires_at
        post: { url: req.urls.webhook },
        redirect: { url: req.urls.redirect },
      }
      const merchantId = typeof runtime.tapMerchantId === 'string' ? runtime.tapMerchantId.trim() : ''
      if (merchantId) body.merchant = { id: merchantId }
      let res: Awaited<ReturnType<FetchLike>>
      try {
        res = await fetchImpl(`${base}/charges`, {
          method: 'POST', headers: { authorization: `Bearer ${keys.secretKey}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
        })
      } catch { throw createError({ statusCode: 502, statusMessage: 'Payment gateway is unreachable' }) }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok || !json) throw createError({ statusCode: 502, statusMessage: 'Payment gateway refused the request' })
      const id = s(json.id)
      const url = s(at(json, 'transaction.url'))
      let host = ''
      try { const u = new URL(url); host = u.protocol === 'https:' ? u.hostname : '' } catch { /* invalid */ }
      // The browser is only ever sent to a Tap-owned https page.
      if (!CHARGE_ID.test(id) || !(host === 'tap.company' || host.endsWith('.tap.company'))) throw createError({ statusCode: 502, statusMessage: 'Payment gateway returned an incomplete session' })
      return { redirectUrl: url, providerOrderId: id }
    },

    parseWebhook(rawBody, headers, _query, runtime) {
      let charge: unknown
      try { charge = JSON.parse(rawBody) } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' }) }
      const id = s(at(charge, 'id'))
      const received = (headers.hashstring ?? '').trim()
      // authorize / token objects are not charges: acknowledge without touching anything
      if (id && !id.startsWith('chg_')) {
        return { eventId: `ignored:${id}`, reference: null, providerOrderId: null, status: 'pending', keyMode: null, providerTransactionId: '', amount: 0, currency: '', raw: { ignored: true } }
      }
      if (!/^[0-9a-f]{64}$/i.test(received)) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
      const keyMode = modesWithKeys(runtime).find((m) => hashstringMatches(charge, rawBody, received, tapKeys(runtime, m)!.secretKey))
      if (!keyMode) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
      return eventFromCharge(charge, keyMode)
    },

    /** The webhook body is only a hint. Settlement uses the charge as Tap's API reports it, for the same key set that signed the hint. */
    async confirm(hook, runtime) {
      if (!hook.providerOrderId || !hook.keyMode) return hook
      const keys = tapKeys(runtime, hook.keyMode)
      if (!keys) throw createError({ statusCode: 503, statusMessage: 'Gateway credentials missing' })
      const charge = await fetchCharge(hook.providerOrderId, keys.secretKey, runtime)
      if (s(at(charge, 'id')) !== hook.providerOrderId) throw createError({ statusCode: 502, statusMessage: 'Gateway returned a different charge' })
      return eventFromCharge(charge, hook.keyMode)
    },

    async verifyReturn(query, runtime, modes) {
      const id = (query.tap_id ?? '').trim()
      if (!CHARGE_ID.test(id)) return null
      for (const m of modesWithKeys(runtime, modes)) {
        try {
          const charge = await fetchCharge(id, tapKeys(runtime, m)!.secretKey, runtime)
          if (s(at(charge, 'id')) === id) return eventFromCharge(charge, m)
        } catch { /* try the next key set, then give up quietly: the result page waits for the webhook */ }
      }
      return null
    },
  }
}
