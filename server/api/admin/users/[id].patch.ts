import { adminUserStatusSchema } from '~~/shared/schemas/admin'
import { forbidden, notFound } from '../../../utils/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ADM-02: change account status (review / active / banned). Admins cannot change their own status.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = event.context.params?.id ?? ''
  if (!UUID.test(id)) throw badRequest('معرّف غير صالح')
  if (id === admin.id) throw forbidden('لا يمكنك تغيير حالة حسابك')
  const { status } = await parseBody(event, adminUserStatusSchema)
  const { data, error } = await serviceClient(event).from('profiles').update({ status }).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound('المستخدم غير موجود')
  await adminAudit(event, admin, 'user_status', 'profiles', id, { status })
  return { ok: true }
})
