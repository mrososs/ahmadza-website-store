import { affiliateStatusSchema } from '~~/shared/schemas/affiliate'
import { audit } from '../../../utils/audit'
import { badRequest, fromDbError, notFound } from '../../../utils/errors'
import { requireAdmin, serviceClient } from '../../../utils/supabase'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Change an affiliate's account status (review / active / banned). A banned or in-review account can no longer buy,
// submit requests or withdraw (create_payment_for_cart / request_withdrawal / requireAffiliate all check status).
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!UUID.test(id)) throw notFound()
  const parsed = affiliateStatusSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('حالة غير صالحة')
  const { data, error } = await serviceClient(event).from('profiles')
    .update({ status: parsed.data.status }).eq('id', id).eq('is_affiliate', true).select('id').maybeSingle()
  if (error) throw fromDbError(error)
  if (!data) throw notFound()
  await audit(event, admin.id, 'affiliate_status', 'profiles', id, { status: parsed.data.status })
  return { ok: true }
})
