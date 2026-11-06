import { z } from 'zod'
import { ADMIN_PAGE_SIZE } from '~~/shared/schemas/admin'

const schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(64).optional().default(''),
  status: z.enum(['all', 'pending', 'succeeded', 'failed', 'cancelled', 'expired']).default('all'),
  provider: z.enum(['all', 'paymob', 'tap', 'dev_simulator']).default('all'),
  mode: z.enum(['all', 'live', 'test']).default('all'),
  review: z.enum(['all', 'needs_review']).default('all'),
})

// Payment reconciliation view. READ-ONLY: payments change state only through the trusted SQL functions
// (create_payment_for_cart / fulfill_payment / fail_payment). `raw_response` is never selected.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const q = parseQuery(event, schema)
  const db = serviceClient(event)
  let query = db.from('payments')
    .select('id,reference,provider,provider_transaction_id,status,amount,currency,mode,created_at,expires_at,paid_at,fulfilled_at,order_id,user_id,needs_review,review_reason,profiles!payments_user_id_fkey(display_name)', { count: 'exact' })
  if (q.status !== 'all') query = query.eq('status', q.status)
  if (q.provider !== 'all') query = query.eq('provider', q.provider)
  if (q.mode !== 'all') query = query.eq('mode', q.mode)
  if (q.review === 'needs_review') query = query.eq('needs_review', true)
  if (q.q) {
    // exact lookups only (reference uuid or provider transaction id): no pattern characters are ever passed to the filter
    if (/^[0-9a-f-]{36}$/i.test(q.q)) query = query.eq('reference', q.q.toLowerCase())
    else if (/^[\w.-]{1,64}$/.test(q.q)) query = query.eq('provider_transaction_id', q.q)
    else return { items: [], total: 0, page: q.page, pageSize: ADMIN_PAGE_SIZE }
  }
  const { data, count, error } = await query.order('created_at', { ascending: false }).range((q.page - 1) * ADMIN_PAGE_SIZE, q.page * ADMIN_PAGE_SIZE - 1)
  if (error) dbFail(error)
  const rows = data ?? []
  const ids = rows.map((r) => r.id)
  const [orders, events] = ids.length
    ? await Promise.all([
      db.from('orders').select('payment_id,order_no').in('payment_id', ids),
      db.from('payment_events').select('payment_id').in('payment_id', ids),
    ])
    : [{ data: [] }, { data: [] }]
  const orderNo = new Map((orders.data ?? []).map((o) => [o.payment_id, o.order_no]))
  const eventCount = new Map<string, number>()
  for (const e of events.data ?? []) if (e.payment_id) eventCount.set(e.payment_id, (eventCount.get(e.payment_id) ?? 0) + 1)
  const now = Date.now()
  return {
    items: rows.map((r) => ({
      ...r,
      order_no: orderNo.get(r.id) ?? null,
      events: eventCount.get(r.id) ?? 0,
      stale: r.status === 'pending' && new Date(r.expires_at).getTime() < now, // abandoned checkout still marked pending
    })),
    total: count ?? 0, page: q.page, pageSize: ADMIN_PAGE_SIZE,
  }
})
