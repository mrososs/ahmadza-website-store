import { notFound } from '../../../../utils/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = event.context.params?.id ?? ''
  if (!UUID.test(id)) throw badRequest('معرّف غير صالح')
  const db = serviceClient(event)
  const { data, error } = await db.from('profiles').update({ deleted_at: null }).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound('المستخدم غير موجود')
  await db.auth.admin.updateUserById(id, { ban_duration: 'none' })
  await adminAudit(event, admin, 'user_restore', 'profiles', id)
  return { ok: true }
})
