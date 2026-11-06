import { affiliatePromoteSchema } from '~~/shared/schemas/affiliate'
import { audit } from '../../../utils/audit'
import { badRequest, fromDbError, notFound } from '../../../utils/errors'
import { requireAdmin, serviceClient } from '../../../utils/supabase'

// Promote an existing, active customer (looked up by e-mail) to affiliate. No password is created or e-mailed
// (legacy admin-created affiliates received a generated password).
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const parsed = affiliatePromoteSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('البريد الإلكتروني غير صالح')
  const db = serviceClient(event)
  const { data: userId } = await db.rpc('find_user_id_by_email', { p_email: parsed.data.email })
  if (!userId) throw notFound('لا يوجد عميل بهذا البريد. يجب أن يسجّل العميل حسابه أولاً.')
  const { data: profile } = await db.from('profiles').select('status,is_affiliate').eq('id', userId).maybeSingle()
  if (!profile) throw notFound()
  if (profile.status === 'banned') throw badRequest('الحساب محظور')
  if (!profile.is_affiliate) {
    const { error } = await db.from('profiles').update({ is_affiliate: true }).eq('id', userId)
    if (error) throw fromDbError(error)
    await audit(event, admin.id, 'affiliate_promoted', 'profiles', userId)
  }
  return { ok: true, id: userId }
})
