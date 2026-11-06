// The ONE place a verified gateway event becomes a state change. The webhook, the browser return and any retry all come through here, so they all
// get the same guarantees: the payment is found by the gateway-signed order id, the key set that signed the event must match the payment's mode,
// money is never fulfilled twice (fulfill_payment locks the row and replays the same answer), a capture that cannot be fulfilled is flagged for the
// admin instead of being dropped, and every distinct provider event is recorded once.
import type { H3Event } from 'h3'
import { createError } from 'h3'
import { serviceClient } from '../../utils/supabase'
import type { ParsedWebhook, PaymentProvider } from './types'

export type SettleResult =
  | { outcome: 'ignored' }
  | { outcome: 'fulfilled'; paymentId: string; reference: string; orderId: string; duplicate: boolean }
  | { outcome: 'failed' | 'pending'; paymentId: string; reference: string }
  | { outcome: 'needs_review'; paymentId: string; reference: string; reason: string }

export async function settle(event: H3Event, provider: PaymentProvider, hook: ParsedWebhook): Promise<SettleResult> {
  if (hook.status === 'pending' && !hook.providerOrderId && !hook.reference) return { outcome: 'ignored' }
  const db = serviceClient(event)

  // 1. find the payment. Gateways: by the signed order id (and our reference when the callback has one). Simulator: by reference.
  let paymentId: string | null = null
  if (hook.providerOrderId) {
    const { data } = await db.rpc('find_payment_for_callback', { p_provider: provider.id, p_reference: hook.reference as string, p_provider_order_id: hook.providerOrderId })
    paymentId = (data as string | null) ?? null
  } else if (hook.reference && provider.id === 'dev_simulator') {
    const { data } = await db.from('payments').select('id').eq('reference', hook.reference).eq('provider', provider.id).maybeSingle()
    paymentId = data?.id ?? null
  }
  if (!paymentId) throw createError({ statusCode: 404, statusMessage: 'payment not found' })

  const { data: pay } = await db.from('payments').select('id,reference,mode,status,order_id').eq('id', paymentId).single()
  if (!pay) throw createError({ statusCode: 404, statusMessage: 'payment not found' })
  const ref = pay.reference as string

  // 2. a test key can never settle a live payment, nor the other way round
  if (hook.keyMode && hook.keyMode !== pay.mode) {
    await db.rpc('flag_payment_review', { p_payment_id: pay.id, p_reason: `event signed with ${hook.keyMode} keys but the payment is ${pay.mode}` })
    return { outcome: 'needs_review', paymentId: pay.id, reference: ref, reason: 'key_mode_mismatch' }
  }

  const register = async (type: string) => (await db.rpc('register_payment_event', { p_provider: provider.id, p_event_id: hook.eventId, p_payment_id: pay.id, p_type: type, p_payload: hook.raw as never })).data !== false

  if (hook.status === 'pending') { await register('pending'); return { outcome: 'pending', paymentId: pay.id, reference: ref } }

  if (hook.status === 'failed') {
    if (hook.reversal && pay.order_id) {
      await db.rpc('flag_payment_review', { p_payment_id: pay.id, p_reason: 'the gateway reports this captured payment as refunded or voided' })
      await register('reversal')
      return { outcome: 'needs_review', paymentId: pay.id, reference: ref, reason: 'reversal' }
    }
    await db.rpc('fail_payment', { p_payment_id: pay.id, p_status: 'failed', p_raw: hook.raw as never })
    await register('failed')
    return { outcome: 'failed', paymentId: pay.id, reference: ref }
  }

  // succeeded: the database compares the amount and currency the GATEWAY reports with the stored payment, and creates the order exactly once
  const { data: orderId, error } = await db.rpc('fulfill_payment', {
    p_payment_id: pay.id, p_provider_txn: hook.providerTransactionId, p_amount: hook.amount, p_currency: hook.currency, p_raw: hook.raw as never,
  })
  if (error) {
    // 22023: already failed/expired, or the captured amount/currency differs. Money moved at the gateway: keep it visible, answer 200 so it stops retrying.
    if (error.code === '22023') {
      await db.rpc('flag_payment_review', { p_payment_id: pay.id, p_reason: error.message })
      await register('captured_needs_review')
      return { outcome: 'needs_review', paymentId: pay.id, reference: ref, reason: error.message }
    }
    throw createError({ statusCode: 500, statusMessage: 'Could not record the payment' }) // transient: the gateway retries
  }
  const isNew = await register('succeeded')
  return { outcome: 'fulfilled', paymentId: pay.id, reference: ref, orderId: orderId as string, duplicate: !isNew }
}
