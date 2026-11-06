import { z } from 'zod'
import { ADMIN_PAGE_SIZE } from '~~/shared/schemas/admin'

const schema = z.object({ page: z.coerce.number().int().min(1).default(1), status: z.enum(['all', 'open', 'handled']).default('all') })

// ADM-16: contact inbox.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const q = parseQuery(event, schema)
  let query = serviceClient(event).from('contact_messages').select('id,name,email,subject,message,is_handled,created_at', { count: 'exact' })
  if (q.status === 'open') query = query.eq('is_handled', false)
  if (q.status === 'handled') query = query.eq('is_handled', true)
  const { data, count, error } = await query.order('id', { ascending: false }).range((q.page - 1) * ADMIN_PAGE_SIZE, q.page * ADMIN_PAGE_SIZE - 1)
  if (error) dbFail(error)
  return { items: data ?? [], total: count ?? 0, page: q.page, pageSize: ADMIN_PAGE_SIZE }
})
