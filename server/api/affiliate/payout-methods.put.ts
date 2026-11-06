import { payoutMethodUpsertSchema } from '~~/shared/schemas/affiliate'
import { badRequest, fromDbError } from '../../utils/errors'
import { rateLimit } from '../../utils/rateLimit'
import { requireAffiliate, serviceClient } from '../../utils/supabase'

// Create/update one payout method (legacy withdraw_types). Validated per kind; details are sensitive (owner + admin only).
export default defineEventHandler(async (event) => {
  rateLimit(event, 'payout-methods', 20, 10 * 60_000)
  const user = await requireAffiliate(event)
  const parsed = payoutMethodUpsertSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('بيانات غير صالحة', parsed.error.flatten().fieldErrors)
  const { kind, is_active, ...details } = parsed.data
  const { error } = await serviceClient(event).from('payout_methods')
    .upsert({ affiliate_id: user.id, kind, details, is_active }, { onConflict: 'affiliate_id,kind' })
  if (error) throw fromDbError(error)
  return { ok: true }
})
