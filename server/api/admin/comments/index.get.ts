import { z } from 'zod'
import { ADMIN_PAGE_SIZE } from '~~/shared/schemas/admin'

const schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(['all', 'pending', 'approved', 'rejected']).default('all'),
  book: z.coerce.number().int().positive().optional(),
})

// CAT-25: comment moderation queue.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const q = parseQuery(event, schema)
  let query = serviceClient(event).from('comments')
    .select('id,body,status,visible_to_public,created_at,book_id,user_id,books(title),profiles(display_name)', { count: 'exact' })
  if (q.status !== 'all') query = query.eq('status', q.status)
  if (q.book) query = query.eq('book_id', q.book)
  const { data, count, error } = await query.order('id', { ascending: false }).range((q.page - 1) * ADMIN_PAGE_SIZE, q.page * ADMIN_PAGE_SIZE - 1)
  if (error) dbFail(error)
  return { items: data ?? [], total: count ?? 0, page: q.page, pageSize: ADMIN_PAGE_SIZE }
})
