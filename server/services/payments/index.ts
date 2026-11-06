import type { H3Event } from 'h3'
import { createError } from 'h3'
import { serviceClient } from '../../utils/supabase'
import { enabledProviders } from './config'
import { devSimulator } from './dev-simulator'
import { paymob, tap } from './gateways'
import type { PaymentProvider, PaymentSettings, ProviderStatus } from './types'

export * from './types'

const providers: Record<string, PaymentProvider> = { dev_simulator: devSimulator, paymob, tap }
export const PROVIDER_ORDER = ['paymob', 'tap', 'dev_simulator'] as const // legacy: Paymob was the default, Tap the alternate

export function getProvider(id: string): PaymentProvider {
  const p = providers[id]
  if (!p) throw createError({ statusCode: 404, statusMessage: 'Unknown payment provider' })
  return p
}

export async function loadPaymentSettings(event: H3Event): Promise<PaymentSettings> {
  const { data, error } = await serviceClient(event).from('site_settings')
    .select('allow_test_payments,payment_mode,base_currency').eq('id', 1).single()
  if (error || !data) throw createError({ statusCode: 500, statusMessage: 'Settings unavailable' })
  return { allow_test_payments: data.allow_test_payments, payment_mode: data.payment_mode, base_currency: data.base_currency }
}

/** Status of every enabled provider (admin sees the reasons; the storefront only sees available or not). */
export function providerStatuses(settings: PaymentSettings, runtime: Record<string, unknown>): ProviderStatus[] {
  const enabled = enabledProviders(runtime)
  return PROVIDER_ORDER.filter((id) => enabled.includes(id)).map((id) => providers[id]!.status(settings, runtime))
}

/** The provider to use: the requested one if it is enabled, else the configured default, else the first available. A requested provider is never silently swapped. */
export function chooseProvider(requested: string | undefined, settings: PaymentSettings, runtime: Record<string, unknown>): PaymentProvider {
  const enabled = enabledProviders(runtime)
  if (requested) {
    if (!enabled.includes(requested)) throw createError({ statusCode: 403, statusMessage: 'طريقة الدفع غير مفعّلة' })
    return getProvider(requested)
  }
  const preferred = typeof runtime.paymentProvider === 'string' ? runtime.paymentProvider : ''
  if (preferred && enabled.includes(preferred)) return getProvider(preferred)
  const first = providerStatuses(settings, runtime).find((s) => s.available)
  if (!first) throw createError({ statusCode: 503, statusMessage: 'الدفع غير متاح حالياً' })
  return getProvider(first.id)
}
