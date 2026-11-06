import { enabledProviders } from '~~/server/services/payments/config'
import { getProvider } from '~~/server/services/payments'
import { settle } from '~~/server/services/payments/settle'
import type { DataMode } from '~~/server/services/payments'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Where the gateway sends the BROWSER after the hosted page. Nothing in the query string is believed: Paymob's redirect is checked against its HMAC,
// Tap's charge is re-fetched from Tap's API, and only then is the same idempotent settlement used as by the webhook. If nothing can be proven the
// customer still lands on the result page, which only ever reports what the database says (usually settled by the webhook a moment later).
export default defineEventHandler(async (event) => {
  rateLimit(event, 'payment-return', 120, 60_000)
  const provider = getProvider(getRouterParam(event, 'provider') ?? '')
  const config = useRuntimeConfig(event)
  if (provider.id === 'dev_simulator' || !enabledProviders(config).includes(provider.id)) throw notFound('provider not enabled')

  const q: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(getQuery(event))) q[k] = Array.isArray(v) ? String(v[0]) : v === undefined ? undefined : String(v)

  const db = serviceClient(event)
  const gatewayId = (provider.id === 'tap' ? q.tap_id : (q.order_id ?? q.order))?.trim()
  let payment: { id: string; reference: string; mode: string; provider_order_id: string | null } | null = null
  if (gatewayId && gatewayId.length <= 80) {
    const { data } = await db.from('payments').select('id,reference,mode,provider_order_id').eq('provider', provider.id).eq('provider_order_id', gatewayId).maybeSingle()
    payment = data
  }
  // only to know where to send the browser; this never grants anything
  const hinted = typeof q.reference === 'string' && UUID.test(q.reference) ? q.reference.toLowerCase() : null

  if (payment && provider.verifyReturn) {
    try {
      const hook = await provider.verifyReturn(q, config, [payment.mode as DataMode])
      if (hook) await settle(event, provider, hook)
    } catch { /* the webhook remains the authority; the result page reports the database state */ }
  }
  const reference = payment?.reference ?? hinted
  setHeader(event, 'cache-control', 'private, no-store')
  return sendRedirect(event, reference ? `/checkout/return?reference=${reference}` : '/checkout/return', 302)
})
