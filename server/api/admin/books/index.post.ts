import { adminBookSchema } from '~~/shared/schemas'
import { adminRelatedSchema } from '~~/shared/schemas/admin'
import { createBook } from '../../../services/adminBooks'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const input = await parseBody(event, adminBookSchema)
  const related = await parseBody(event, adminRelatedSchema) // h3 caches the parsed body; extra keys are stripped per schema
  const created = await createBook(event, input, related.related_ids)
  await adminAudit(event, admin, 'create', 'books', created.id)
  setResponseStatus(event, 201)
  return created
})
