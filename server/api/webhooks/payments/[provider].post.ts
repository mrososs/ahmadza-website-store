import { getProvider, loadPaymentSettings } from '~~/server/services/payments'

// Gateway webhook. The signature is verified over the RAW body; processing is idempotent:
// fulfill_payment() locks the payment row and returns the existing order on replay, and the provider event id is
// recorded in payment_events (unique per provider) so a replay is reported as { duplicate: true } and does nothing.
export default defineEventHandler(async (event) => {
  const provider = getProvider(getRouterParam(event, 'provider') ?? '') // unknown -> 404
  const config = useRuntimeConfig(event)
  provider.assertAvailable(await loadPaymentSettings(event), config)

  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const headers: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(getRequestHeaders(event))) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v
  const hook = provider.parseWebhook(raw, headers) // throws 401 on a bad signature

  const db = serviceClient(event)
  const { data: pay } = await db.from('payments').select('id,provider').eq('reference', hook.reference).maybeSingle()
  if (!pay || pay.provider !== provider.id) throw notFound('payment not found')

  let orderId: string | null = null
  if (hook.status === 'succeeded') {
    const { data, error } = await db.rpc('fulfill_payment', {
      p_payment_id: pay.id, p_provider_txn: hook.providerTransactionId, p_amount: hook.amount, p_currency: hook.currency, p_raw: hook.raw as never,
    })
    if (error) throw fromDbError(error)
    orderId = data as string
  } else {
    await db.rpc('fail_payment', { p_payment_id: pay.id, p_status: 'failed', p_raw: hook.raw as never })
  }
  const { data: isNew } = await db.rpc('register_payment_event', {
    p_provider: provider.id, p_event_id: hook.eventId, p_payment_id: pay.id, p_type: hook.status, p_payload: hook.raw as never,
  })
  return { ok: true, duplicate: isNew === false, orderId }
})
