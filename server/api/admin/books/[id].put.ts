import { adminBookSchema } from '~~/shared/schemas'
import { adminRelatedSchema } from '~~/shared/schemas/admin'
import { updateBook } from '../../../services/adminBooks'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  const input = await parseBody(event, adminBookSchema)
  const related = await parseBody(event, adminRelatedSchema)
  await updateBook(event, id, input, related.related_ids)
  await adminAudit(event, admin, 'update', 'books', id)
  return { ok: true }
})
