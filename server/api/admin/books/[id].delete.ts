import { setBookDeleted } from '../../../services/adminBooks'

// Soft delete (CAT-18). The legacy "e-mail every buyer all files before deleting" side effect is intentionally dropped.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  await setBookDeleted(event, id, true)
  await adminAudit(event, admin, 'soft_delete', 'books', id)
  return { ok: true }
})
