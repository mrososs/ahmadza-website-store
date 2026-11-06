import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError } from 'h3'
import { devWebhookSchema } from '~~/shared/schemas/commerce'
import type { PaymentProvider } from './types'

/**
 * LOCAL DEVELOPMENT SIMULATOR — it never represents a real payment.
 * Refused when NODE_ENV=production, when runtimeConfig.allowDevPaymentSimulator is not true, or when
 * site_settings.allow_test_payments is false. Payments it creates are always mode='test' (also enforced by a DB CHECK),
 * and the resulting entitlements are flagged is_test.
 */
export const DEV_WEBHOOK_SECRET_FALLBACK = 'local-dev-only-webhook-secret'
const secret = () => process.env.DEV_PAYMENT_WEBHOOK_SECRET || DEV_WEBHOOK_SECRET_FALLBACK

export const devSign = (rawBody: string) => createHmac('sha256', secret()).update(rawBody).digest('hex')

export const devSimulator: PaymentProvider = {
  id: 'dev_simulator',
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
  async createSession({ reference }) {
    return { redirectUrl: `/checkout/simulate/${reference}` }
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
      eventId: p.data.event_id, reference: p.data.reference, status: p.data.status,
      providerTransactionId: p.data.transaction_id, amount: p.data.amount, currency: p.data.currency.toUpperCase(),
      raw: p.data as unknown as Record<string, unknown>,
    }
  },
}
