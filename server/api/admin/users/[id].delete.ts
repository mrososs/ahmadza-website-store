import { forbidden, notFound } from '../../../utils/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// AUTH-17: soft delete (profiles.deleted_at) + the auth user is banned so the account can no longer sign in.
// Orders and entitlements are kept untouched (financial history is never removed).
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = event.context.params?.id ?? ''
  if (!UUID.test(id)) throw badRequest('معرّف غير صالح')
  if (id === admin.id) throw forbidden('لا يمكنك حذف حسابك')
  const db = serviceClient(event)
  const { data, error } = await db.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound('المستخدم غير موجود')
  await db.auth.admin.updateUserById(id, { ban_duration: '876000h' })
  await adminAudit(event, admin, 'user_soft_delete', 'profiles', id)
  return { ok: true }
})
