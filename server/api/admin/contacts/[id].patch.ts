import { adminContactUpdateSchema } from '~~/shared/schemas/admin'
import { notFound } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  const patch = await parseBody(event, adminContactUpdateSchema)
  const { data, error } = await serviceClient(event).from('contact_messages').update(patch).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound()
  await adminAudit(event, admin, 'contact_handled', 'contact_messages', id, patch)
  return { ok: true }
})
