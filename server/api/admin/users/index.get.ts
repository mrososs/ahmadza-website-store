import { ADMIN_PAGE_SIZE, adminListQuerySchema } from '~~/shared/schemas/admin'
import { escapeLike } from '../../../services/adminCrud'

// ADM-01: customer list (status filter: all | review | active | banned | trash) with e-mail search.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const q = parseQuery(event, adminListQuerySchema)
  const { data, error } = await serviceClient(event).rpc('admin_list_users', {
    p_q: escapeLike(q.q), p_status: q.status, p_limit: ADMIN_PAGE_SIZE, p_offset: (q.page - 1) * ADMIN_PAGE_SIZE,
  })
  if (error) dbFail(error)
  const rows = data ?? []
  return { items: rows.map(({ total_count: _t, ...r }) => r), total: Number(rows[0]?.total_count ?? 0), page: q.page, pageSize: ADMIN_PAGE_SIZE }
})
