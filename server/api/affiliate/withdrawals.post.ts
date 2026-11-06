import { withdrawalAmountSchema } from '~~/shared/schemas/affiliate'
import { badRequest, fromDbError } from '../../utils/errors'
import { rateLimit } from '../../utils/rateLimit'
import { requireAffiliate, serviceClient } from '../../utils/supabase'

// Withdrawal request: the amount is checked against the ledger under a per-affiliate lock inside request_withdrawal().
export default defineEventHandler(async (event) => {
  rateLimit(event, 'withdraw', 10, 10 * 60_000)
  const user = await requireAffiliate(event)
  const parsed = withdrawalAmountSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('قيمة غير صالحة', parsed.error.flatten().fieldErrors)
  const amount = Math.round(parsed.data.amount * 100) / 100
  const { data, error } = await serviceClient(event).rpc('request_withdrawal', { p_affiliate: user.id, p_amount: amount })
  if (error) throw fromDbError(error)
  return { ok: true, id: data }
})
