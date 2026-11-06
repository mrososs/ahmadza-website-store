import { idSchema } from '~~/shared/schemas'
import { badRequest } from '../../../utils/errors'
import { rateLimit } from '../../../utils/rateLimit'
import { serviceClient } from '../../../utils/supabase'

// View counter (book | article). Client also guards once per session; the server rate limit stops scripted inflation.
export default defineEventHandler(async (event) => {
  const entity = getRouterParam(event, 'entity')
  const id = idSchema.safeParse(getRouterParam(event, 'id'))
  if ((entity !== 'book' && entity !== 'article') || !id.success) throw badRequest('طلب غير صالح')
  rateLimit(event, `view:${entity}:${id.data}`, 3, 60 * 60_000)
  await serviceClient(event).rpc('increment_view', { p_entity: entity, p_id: id.data })
  return { ok: true }
})
