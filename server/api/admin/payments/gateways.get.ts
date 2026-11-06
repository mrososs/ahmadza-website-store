import { getProvider, loadPaymentSettings, PROVIDER_ORDER } from '~~/server/services/payments'
import { callbackOrigin, liveEnabled } from '~~/server/services/payments/config'

// Read-only readiness of every payment gateway for the admin. It reports variable NAMES, never values, and never contacts a gateway.
// `verified` is false until the owner attests (NUXT_<PROVIDER>_VERIFIED=true) that an authorised end-to-end sandbox run passed.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const settings = await loadPaymentSettings(event)
  const cfg = useRuntimeConfig(event)
  let origin = ''
  let originProblem: string | null = null
  try { origin = callbackOrigin(cfg, cfg.public.siteUrl) } catch (e) { originProblem = (e as Error).message }
  const publicOrigin = /^https:\/\//.test(origin)
  setHeader(event, 'cache-control', 'no-store')
  return {
    mode: settings.payment_mode,
    currency: settings.base_currency,
    allowTestPayments: settings.allow_test_payments,
    liveEnabled: liveEnabled(cfg),
    origin: { value: origin, https: publicOrigin, problem: originProblem, note: 'Gateways cannot call back to localhost or plain http: set NUXT_PAYMENTS_PUBLIC_BASE_URL to the public https origin.' },
    webhookUrls: Object.fromEntries(['paymob', 'tap'].map((id) => [id, `${origin}/api/webhooks/payments/${id}`])),
    providers: PROVIDER_ORDER.map((id) => getProvider(id).status(settings, cfg)),
  }
})
