import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { devWebhookSchema } from '~~/shared/schemas/commerce'
import { enabledProviders } from './config'
import type { PaymentProvider, ProviderStatus } from './types'

/**
 * LOCAL DEVELOPMENT SIMULATOR — it never represents a real payment.
 * Refused when NODE_ENV=production, when runtimeConfig.allowDevPaymentSimulator is not true, or when
 * site_settings.allow_test_payments is false. Payments it creates are always mode='test' (also enforced by a DB CHECK),
 * and the resulting entitlements are flagged is_test.
 */
export const DEV_WEBHOOK_SECRET_FALLBACK = 'local-dev-only-webhook-secret'
const secret = () => process.env.DEV_PAYMENT_WEBHOOK_SECRET || DEV_WEBHOOK_SECRET_FALLBACK

export const devSign = (rawBody: string) => createHmac('sha256', secret()).update(rawBody).digest('hex')

function simulatorReason(settings: { allow_test_payments: boolean }, runtime: { allowDevPaymentSimulator?: unknown }): string | null {
  const enabled = runtime.allowDevPaymentSimulator === true || runtime.allowDevPaymentSimulator === 'true'
  if (process.env.NODE_ENV === 'production' || !enabled) return 'Development payment simulator is disabled'
  if (!settings.allow_test_payments) return 'Test payments are disabled in site settings'
  return null
}

export const devSimulator: PaymentProvider = {
  id: 'dev_simulator',
  label: 'Development simulator',
  status(settings, runtime): ProviderStatus {
    const reason = simulatorReason(settings, runtime) ?? (enabledProviders(runtime).includes('dev_simulator') ? null : 'provider is not in NUXT_PAYMENTS_ENABLED_PROVIDERS')
    return { id: 'dev_simulator', label: 'Development simulator', enabled: enabledProviders(runtime).includes('dev_simulator'), configured: true, missing: [], mode: 'test', liveAllowed: false, available: !reason, reason, verified: false,
      currency: { store: settings.base_currency, gateway: settings.base_currency, matches: true } }
  },
  assertAvailable(settings, runtime) {
    const enabled = runtime.allowDevPaymentSimulator === true || runtime.allowDevPaymentSimulator === 'true'
    if (process.env.NODE_ENV === 'production' || !enabled) {
      throw createError({ statusCode: 403, statusMessage: 'Development payment simulator is disabled' })
    }
    if (!settings.allow_test_payments) {
      throw createError({ statusCode: 403, statusMessage: 'Test payments are disabled in site settings' })
    }
  },
  mode: () => 'test',
  async createSession({ payment }) {
    return { redirectUrl: `/checkout/simulate/${payment.reference}`, providerOrderId: null }
  },
  parseWebhook(rawBody, headers) {
    const given = Buffer.from(headers['x-aawraq-signature'] ?? '', 'hex')
    const expected = Buffer.from(devSign(rawBody), 'hex')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
    }
    let json: unknown
    try { json = JSON.parse(rawBody) } catch { throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' }) }
    const p = devWebhookSchema.safeParse(json)
    if (!p.success) throw createError({ statusCode: 400, statusMessage: 'Invalid webhook payload' })
    return {
      eventId: p.data.event_id, reference: p.data.reference, providerOrderId: null, keyMode: null, status: p.data.status,
      providerTransactionId: p.data.transaction_id, amount: p.data.amount, currency: p.data.currency.toUpperCase(),
      raw: p.data as unknown as Record<string, unknown>,
    }
  },
}
