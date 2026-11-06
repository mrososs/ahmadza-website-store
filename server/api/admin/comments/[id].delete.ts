import { notFound } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  const { data, error } = await serviceClient(event).from('comments').delete().eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound()
  await adminAudit(event, admin, 'comment_delete', 'comments', id)
  return { ok: true }
})
