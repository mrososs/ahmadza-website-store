import { simulateSchema } from '~~/shared/schemas/commerce'
import { getProvider, loadPaymentSettings } from '~~/server/services/payments'

// DEVELOPMENT SIMULATION ONLY. The amount fulfilled is the one stored on the payment row — nothing from the client.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit(event, 'checkout-simulate', 30, 60_000)
  const reference = getRouterParam(event, 'reference') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(reference)) throw badRequest('مرجع غير صالح')
  const parsed = simulateSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('طلب غير صالح')

  const config = useRuntimeConfig(event)
  getProvider('dev_simulator').assertAvailable(await loadPaymentSettings(event), config)

  const db = serviceClient(event)
  const { data: pay } = await db.from('payments')
    .select('id,user_id,provider,status,amount,currency,order_id').eq('reference', reference).maybeSingle()
  // owner only; a different user's payment looks like "not found"
  if (!pay || pay.user_id !== user.id || pay.provider !== 'dev_simulator') throw notFound('عملية الدفع غير موجودة')

  if (parsed.data.outcome === 'failure') {
    await db.rpc('fail_payment', { p_payment_id: pay.id, p_status: 'failed', p_raw: { simulated: true } })
    await db.rpc('register_payment_event', { p_provider: 'dev_simulator', p_event_id: `sim:${reference}:failure`, p_payment_id: pay.id, p_type: 'failed', p_payload: { simulated: true } })
    return { status: 'failed', orderNo: null }
  }

  const { data: orderId, error } = await db.rpc('fulfill_payment', {
    p_payment_id: pay.id, p_provider_txn: `SIM-${pay.id}`, p_amount: Number(pay.amount), p_currency: pay.currency, p_raw: { simulated: true },
  })
  if (error) throw fromDbError(error)
  await db.rpc('register_payment_event', { p_provider: 'dev_simulator', p_event_id: `sim:${reference}:success`, p_payment_id: pay.id, p_type: 'succeeded', p_payload: { simulated: true } })
  const { data: order } = await db.from('orders').select('order_no').eq('id', orderId as string).single()
  return { status: 'succeeded', orderNo: order?.order_no ?? null }
})
