import { loadPaymentSettings, providerStatuses } from '~~/server/services/payments'

const LABEL: Record<string, string> = { paymob: 'بطاقة بنكية / Apple Pay (Paymob)', tap: 'بطاقة / مدى (Tap)', dev_simulator: 'محاكاة الدفع (للتجربة فقط)' }

// The payment methods the storefront may offer RIGHT NOW: ONLY those that can really start a session. A method that is disabled, unconfigured, in the wrong
// currency or not allowed live is not listed at all, so a customer is never shown a choice that cannot work. Public and thin: never why, never how it is configured.
export default defineEventHandler(async (event) => {
  const settings = await loadPaymentSettings(event)
  const statuses = providerStatuses(settings, useRuntimeConfig(event))
  setHeader(event, 'cache-control', 'no-store')
  return {
    methods: statuses.filter((s) => s.available).map((s) => ({ id: s.id, label: LABEL[s.id] ?? s.label, available: true })),
    testMode: settings.payment_mode === 'test',
    currency: settings.base_currency,
  }
})
