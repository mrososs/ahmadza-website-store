import { adminCommentUpdateSchema } from '~~/shared/schemas/admin'
import { notFound } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  const patch = await parseBody(event, adminCommentUpdateSchema)
  if (Object.keys(patch).length === 0) throw badRequest('لا توجد تغييرات')
  const { data, error } = await serviceClient(event).from('comments').update(patch).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound()
  await adminAudit(event, admin, 'comment_moderate', 'comments', id, patch)
  return { ok: true }
})
