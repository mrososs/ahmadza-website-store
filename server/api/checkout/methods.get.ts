import { loadPaymentSettings, providerStatuses } from '~~/server/services/payments'

const LABEL: Record<string, string> = { paymob: 'بطاقة بنكية / Apple Pay (Paymob)', tap: 'بطاقة / مدى (Tap)', dev_simulator: 'محاكاة الدفع (للتجربة فقط)' }

// Which payment methods the storefront may offer RIGHT NOW. Public and deliberately thin: whether a method can be used, never why or how it is configured.
export default defineEventHandler(async (event) => {
  const settings = await loadPaymentSettings(event)
  const statuses = providerStatuses(settings, useRuntimeConfig(event))
  setHeader(event, 'cache-control', 'no-store')
  return {
    methods: statuses.map((s) => ({ id: s.id, label: LABEL[s.id] ?? s.label, available: s.available })),
    testMode: settings.payment_mode === 'test',
    currency: settings.base_currency,
  }
})
