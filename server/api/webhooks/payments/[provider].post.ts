import { enabledProviders } from '~~/server/services/payments/config'
import { getProvider, loadPaymentSettings } from '~~/server/services/payments'
import { settle } from '~~/server/services/payments/settle'

// Gateway webhook. The signature is verified over the RAW body (Paymob: HMAC-SHA512 in ?hmac=; Tap: HMAC-SHA256 in the hashstring header, then the
// charge is re-fetched from Tap's API). Settlement is idempotent: the payment is found by the gateway-signed order id, fulfill_payment() locks the
// row and replays the same answer, and each provider event id is recorded once. A capture that cannot be fulfilled is flagged for the admin, never lost.
// Settling a verified event is deliberately NOT blocked by "live payments disabled": that switch stops NEW sessions, not money already taken.
export default defineEventHandler(async (event) => {
  rateLimit(event, 'payment-webhook', 600, 60_000)
  const provider = getProvider(getRouterParam(event, 'provider') ?? '') // unknown -> 404
  const config = useRuntimeConfig(event)
  if (provider.id === 'dev_simulator') provider.assertAvailable(await loadPaymentSettings(event), config)
  else if (!enabledProviders(config).includes(provider.id)) throw notFound('provider not enabled')
  if (contentLength(event) > 65_536) throw createError({ statusCode: 413, statusMessage: 'payload too large' })

  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const headers: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(getRequestHeaders(event))) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
  const query: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(getQuery(event))) query[k] = Array.isArray(v) ? String(v[0]) : v === undefined ? undefined : String(v)

  let hook = provider.parseWebhook(raw, headers, query, config) // throws 401 on a bad signature
  if (provider.confirm) hook = await provider.confirm(hook, config) // Tap: the API's own answer replaces the callback body
  const r = await settle(event, provider, hook)
  return r.outcome === 'fulfilled' ? { ok: true, duplicate: r.duplicate, orderId: r.orderId } : { ok: true, outcome: r.outcome }
})
