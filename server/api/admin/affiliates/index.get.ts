import { fromDbError } from '../../../utils/errors'
import { requireAdmin, serviceClient } from '../../../utils/supabase'

// Admin affiliate list with ledger-derived balances.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { data, error } = await serviceClient(event).rpc('admin_affiliate_overview')
  if (error) throw fromDbError(error)
  return (data ?? []).map((a) => ({ ...a, earned: Number(a.earned), available: Number(a.available), frozen: Number(a.frozen) }))
})
