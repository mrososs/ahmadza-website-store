import { z } from 'zod'
import { ADMIN_PAGE_SIZE } from '~~/shared/schemas/admin'

const schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(20).optional().default(''),
  status: z.enum(['all', 'paid', 'failed', 'refunded']).default('all'),
  mode: z.enum(['all', 'live', 'test']).default('all'),
})

// Orders are APPEND-ONLY: this slice only lists and shows them (admins cannot change an order's status — see docs 07).
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const q = parseQuery(event, schema)
  let query = serviceClient(event).from('orders')
    .select('id,order_no,status,mode,total_amount,currency,created_at,user_id,profiles!orders_user_id_fkey(display_name)', { count: 'exact' })
    .is('deleted_at', null)
  if (q.status !== 'all') query = query.eq('status', q.status)
  if (q.mode !== 'all') query = query.eq('mode', q.mode)
  if (/^\d+$/.test(q.q)) query = query.eq('order_no', Number(q.q))
  const { data, count, error } = await query.order('created_at', { ascending: false }).range((q.page - 1) * ADMIN_PAGE_SIZE, q.page * ADMIN_PAGE_SIZE - 1)
  if (error) dbFail(error)
  return { items: data ?? [], total: count ?? 0, page: q.page, pageSize: ADMIN_PAGE_SIZE }
})
