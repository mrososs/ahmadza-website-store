import { DOCUMENT_URL_TTL } from '~~/shared/constants/affiliate'
import { forbidden, notFound } from '../../../../utils/errors'
import { callerIsAdmin } from '../../../../utils/roles'
import { requireUser, serviceClient } from '../../../../utils/supabase'

// Withdrawal proof (private-sensitive bucket): owner or admin only, via a short-lived signed URL.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound()
  const db = serviceClient(event)
  const { data: w } = await db.from('withdrawal_requests').select('affiliate_id,proof_path').eq('id', id).maybeSingle()
  if (!w) throw notFound()
  if (w.affiliate_id !== user.id && !(await callerIsAdmin(event))) throw forbidden()
  if (!w.proof_path) throw notFound('لا يوجد مرفق')
  const { data, error } = await db.storage.from('private-sensitive').createSignedUrl(w.proof_path, DOCUMENT_URL_TTL)
  if (error || !data) throw notFound()
  return sendRedirect(event, data.signedUrl, 302)
})
