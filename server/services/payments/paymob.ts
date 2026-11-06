// Paymob (KSA) adapter: Unified Checkout through the Intention API.
// Sources (read 2026-11-06): developers.paymob.com  Create Intention; Unified Checkout redirection; HMAC Transaction Callback.
// Legacy evidence (recovered Laravel code): Paymob was the DEFAULT provider, hosted checkout, HMAC-SHA512 verification, amount and currency compared
// with the stored payment. Everything below is NOT VERIFIED end to end until an authorised sandbox run passes: it is covered by contract tests only.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { PAYMOB_REGIONS, currencyAssurance, httpsBase, paymobRegion, paymobKeys, paymobMissing, refuse, unavailableReason } from './config'
import type { DataMode, FetchLike, GatewayRuntime, ParsedWebhook, PaymentProvider, ProviderStatus, SessionRequest, SessionResult } from './types'

/** Order is the documented one. Concatenate the VALUES in this order with no separator, HMAC-SHA512 with the HMAC secret, compare with ?hmac=. */
export const PAYMOB_HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'obj.id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture',
  'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))
const at = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o)

export function paymobConcatenate(get: (field: (typeof PAYMOB_HMAC_FIELDS)[number]) => unknown): string {
  return PAYMOB_HMAC_FIELDS.map((f) => text(get(f))).join('')
}
/** Processed (POST) callback: the transaction is `obj`; `obj.id` and `order.id` are read from it. */
export const postFields = (obj: unknown) => paymobConcatenate((f) => at(obj, f.replace(/^obj\./, '')))
/** Response (GET) callback: flat query parameters; the docs name the keys `id` and `order_id`. */
export const getFields = (q: Record<string, string | undefined>) =>
  paymobConcatenate((f) => (f === 'obj.id' ? q.id : f === 'order.id' ? (q.order_id ?? q.order) : q[f]))

export function hmacMatches(concatenated: string, received: string, secret: string): boolean {
  const given = Buffer.from(received.toLowerCase(), 'hex')
  const expected = createHmac('sha512', secret).update(concatenated).digest()
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const modesWithKeys = (runtime: GatewayRuntime, only?: DataMode[]) => (['test', 'live'] as const).filter((m) => (!only || only.includes(m)) && paymobKeys(runtime, m))

/** The part of a transaction we are willing to store: no card digits, no billing or customer data. */
function safeSubset(o: Record<string, unknown>): Record<string, unknown> {
  return {
    id: o.id, amount_cents: o.amount_cents, currency: o.currency, success: o.success, pending: o.pending, error_occured: o.error_occured,
    is_auth: o.is_auth, is_capture: o.is_capture, is_voided: o.is_voided, is_refunded: o.is_refunded, integration_id: o.integration_id,
    created_at: o.created_at, order_id: at(o, 'order.id'), source_type: at(o, 'source_data.type'), source_sub_type: at(o, 'source_data.sub_type'),
  }
}

/** Success needs a captured, settled, non-reversed transaction. Authorised-only (is_auth without is_capture) is not money yet. */
export function classify(o: { success: unknown; pending: unknown; is_voided: unknown; is_refunded: unknown; error_occured: unknown; is_auth: unknown; is_capture: unknown }) {
  const t = (v: unknown) => v === true || v === 'true'
  if (t(o.is_voided) || t(o.is_refunded)) return { status: 'failed' as const, reversal: true }
  if (t(o.pending) || (t(o.is_auth) && !t(o.is_capture))) return { status: 'pending' as const, reversal: false }
  if (t(o.success) && !t(o.error_occured)) return { status: 'succeeded' as const, reversal: false }
  return { status: 'failed' as const, reversal: false }
}

function toEvent(o: Record<string, unknown>, keyMode: DataMode, ref: unknown): ParsedWebhook {
  const amountCents = Number(o.amount_cents)
  const orderId = text(at(o, 'order.id') ?? o.order_id ?? o.order)
  if (!Number.isFinite(amountCents) || !orderId) throw createError({ statusCode: 400, statusMessage: 'Invalid webhook payload' })
  const c = classify(o as never)
  const reference = typeof ref === 'string' && UUID.test(ref) ? ref.toLowerCase() : null
  return {
    eventId: [o.id, o.success, o.pending, o.is_voided, o.is_refunded].map(text).join(':'),
    reference, providerOrderId: orderId, status: c.status, reversal: c.reversal, keyMode, providerTransactionId: text(o.id),
    amount: amountCents / 100, currency: text(o.currency).toUpperCase(), raw: safeSubset(o),
  }
}

export function createPaymob(fetchImpl: FetchLike = (url, init) => fetch(url, init) as never): PaymentProvider {
  const status = (settings: Parameters<PaymentProvider['status']>[0], runtime: GatewayRuntime): ProviderStatus => {
    const mode = settings.payment_mode
    const missing = paymobMissing(runtime, mode)
    const currency = currencyAssurance('Paymob', runtime.paymobCurrency, settings)
    const verified = runtime.paymobVerified === true || String(runtime.paymobVerified).toLowerCase() === 'true'
    const region = paymobRegion(runtime)
    const reason = !region ? 'NUXT_PAYMOB_REGION must be one of ksa, egypt, uae, oman' : unavailableReason({ id: 'paymob', runtime, settings, configured: !missing.length, verified, currency, currencyVar: 'NUXT_PAYMOB_CURRENCY' })
    const enabled = String(runtime.paymentsEnabledProviders ?? '').split(',').map((s) => s.trim()).includes('paymob')
    return {
      id: 'paymob', label: 'Paymob', enabled, configured: !missing.length, missing, mode, liveAllowed: mode === 'live' && !reason, available: !reason, reason, verified,
      currency, region: region ?? String(runtime.paymobRegion ?? ''),
    }
  }

  return {
    id: 'paymob',
    label: 'Paymob',
    status,
    assertAvailable(settings, runtime) { const r = status(settings, runtime).reason; if (r) refuse(r) },
    mode: (s) => s.payment_mode,

    async createSession(req: SessionRequest, runtime: GatewayRuntime): Promise<SessionResult> {
      const keys = paymobKeys(runtime, req.payment.mode)
      if (!keys) refuse(`credentials for ${req.payment.mode} mode are not configured`)
      const region = paymobRegion(runtime)
      if (!region) refuse('NUXT_PAYMOB_REGION must be one of ksa, egypt, uae, oman')
      const base = httpsBase(runtime.paymobBaseUrl, PAYMOB_REGIONS[region].base)
      const checkout = httpsBase(runtime.paymobCheckoutUrl, PAYMOB_REGIONS[region].checkout)
      const cents = (n: number) => Math.round(n * 100)
      const items = req.items.map((i) => ({ name: i.name.slice(0, 50), amount: cents(i.amount), description: i.name.slice(0, 50), quantity: 1 }))
      // Paymob rejects an intention whose items do not add up to the amount: refuse here rather than send a wrong total.
      if (items.reduce((s, i) => s + i.amount, 0) !== cents(req.payment.amount)) throw createError({ statusCode: 500, statusMessage: 'Cart total mismatch' })
      const first = req.customer.name.trim().split(/\s+/)[0] || 'Customer'
      const last = req.customer.name.trim().split(/\s+/).slice(1).join(' ') || first
      const body = {
        amount: cents(req.payment.amount),
        currency: req.payment.currency,
        payment_methods: keys.integrationIds,
        items,
        // Placeholders reproduce the legacy store (Riyadh/NA): the gateway requires these keys, we do not collect addresses.
        billing_data: {
          first_name: first, last_name: last, email: req.customer.email, phone_number: req.customer.phone || String(runtime.paymobFallbackPhone || '+966500000000'),
          country: 'SA', city: 'Riyadh', street: 'NA', building: 'NA', floor: 'NA', apartment: 'NA',
        },
        customer: { first_name: first, last_name: last, email: req.customer.email, extras: { reference: req.payment.reference } },
        extras: { reference: req.payment.reference },
        special_reference: req.payment.reference,
        notification_url: req.urls.webhook,
        redirection_url: req.urls.redirect,
      }
      let res: Awaited<ReturnType<FetchLike>>
      try {
        res = await fetchImpl(`${base}/v1/intention/`, {
          method: 'POST', headers: { authorization: `Token ${keys.secretKey}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
        })
      } catch { throw createError({ statusCode: 502, statusMessage: 'Payment gateway is unreachable' }) }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok || !json) throw createError({ statusCode: 502, statusMessage: 'Payment gateway refused the request' })
      const secret = json.client_secret
      const orderId = json.intention_order_id
      // Without the gateway's own order id a later callback cannot be bound to this payment, so the session is refused (fail closed).
      if (typeof secret !== 'string' || !secret || (typeof orderId !== 'number' && typeof orderId !== 'string') || text(orderId) === '') {
        throw createError({ statusCode: 502, statusMessage: 'Payment gateway returned an incomplete session' })
      }
      return { redirectUrl: `${checkout}/?publicKey=${encodeURIComponent(keys.publicKey)}&clientSecret=${encodeURIComponent(secret)}`, providerOrderId: text(orderId) }
    },

    parseWebhook(rawBody, _headers, query, runtime) {
      let body: unknown
      try { body = JSON.parse(rawBody) } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' }) }
      const b = body as { type?: unknown; obj?: unknown }
      // A card-token callback (type TOKEN) is not a payment event and carries a different HMAC: acknowledge and ignore, change nothing.
      if (typeof b?.type === 'string' && b.type !== 'TRANSACTION') {
        return { eventId: `ignored:${b.type}`, reference: null, providerOrderId: null, status: 'pending', keyMode: null, providerTransactionId: '', amount: 0, currency: '', raw: { ignored: b.type } }
      }
      const obj = b?.obj
      if (!obj || typeof obj !== 'object') throw createError({ statusCode: 400, statusMessage: 'Invalid webhook payload' })
      const received = (query.hmac ?? '').trim()
      if (!/^[0-9a-f]{128}$/i.test(received)) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
      const concatenated = postFields(obj)
      const keyMode = modesWithKeys(runtime).find((m) => hmacMatches(concatenated, received, paymobKeys(runtime, m)!.hmacSecret))
      if (!keyMode) throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
      const o = obj as Record<string, unknown>
      return toEvent(o, keyMode, at(o, 'order.merchant_order_id') ?? at(o, 'payment_key_claims.extra.reference') ?? at(o, 'payment_key_claims.extra.reference'))
    },

    async verifyReturn(query, runtime, modes) {
      const received = (query.hmac ?? '').trim()
      if (!/^[0-9a-f]{128}$/i.test(received)) return null
      const concatenated = getFields(query)
      const keyMode = modesWithKeys(runtime, modes).find((m) => hmacMatches(concatenated, received, paymobKeys(runtime, m)!.hmacSecret))
      if (!keyMode) return null
      try { return toEvent({ ...query, order_id: query.order_id ?? query.order }, keyMode, query.merchant_order_id) } catch { return null }
    },
  }
}
