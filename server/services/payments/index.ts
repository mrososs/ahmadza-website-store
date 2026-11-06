import type { H3Event } from 'h3'
import { createError } from 'h3'
import { serviceClient } from '../../utils/supabase'
import { devSimulator } from './dev-simulator'
import { paymob, tap } from './gateways'
import type { PaymentProvider, PaymentSettings } from './types'

export * from './types'

const providers: Record<string, PaymentProvider> = { dev_simulator: devSimulator, paymob, tap }

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
