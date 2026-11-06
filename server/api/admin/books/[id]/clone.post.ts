import { cloneBook } from '../../../../services/adminBooks'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  const created = await cloneBook(event, id)
  await adminAudit(event, admin, 'clone', 'books', created.id, { source: id })
  setResponseStatus(event, 201)
  return created
})
