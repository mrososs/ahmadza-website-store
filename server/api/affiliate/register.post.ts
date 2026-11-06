import { AFFILIATE_SELF_REGISTRATION } from '~~/shared/constants/affiliate'
import { forbidden, fromDbError } from '../../utils/errors'
import { rateLimit } from '../../utils/rateLimit'
import { requireUser, serviceClient } from '../../utils/supabase'

// Legacy AUTH-14: any signed-up customer could become an affiliate. Only an ACTIVE account may do so, and only
// through this route (profiles.is_affiliate is not writable through the Data API).
export default defineEventHandler(async (event) => {
  rateLimit(event, 'affiliate-register', 10, 10 * 60_000)
  const user = await requireUser(event)
  if (!AFFILIATE_SELF_REGISTRATION) throw forbidden('التسجيل كمسوّق متاح عبر الإدارة فقط')
  const db = serviceClient(event)
  const { data: profile } = await db.from('profiles').select('status,is_affiliate').eq('id', user.id).maybeSingle()
  if (!profile || profile.status !== 'active') throw forbidden('الحساب غير مفعّل')
  if (profile.is_affiliate) return { ok: true, alreadyAffiliate: true }
  const { error } = await db.from('profiles').update({ is_affiliate: true }).eq('id', user.id)
  if (error) throw fromDbError(error)
  return { ok: true, alreadyAffiliate: false }
})
