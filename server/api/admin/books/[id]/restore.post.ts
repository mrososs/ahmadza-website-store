import { setBookDeleted } from '../../../../services/adminBooks'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  await setBookDeleted(event, id, false)
  await adminAudit(event, admin, 'restore', 'books', id)
  return { ok: true }
})
