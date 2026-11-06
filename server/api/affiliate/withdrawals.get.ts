import { requireAffiliate, serviceClient } from '../../utils/supabase'

// Own withdrawal history. Served here (not via the Data API) because proof_path is intentionally not column-granted.
export default defineEventHandler(async (event) => {
  const user = await requireAffiliate(event)
  const { data } = await serviceClient(event).from('withdrawal_requests')
    .select('id,amount,currency,status,note,proof_path,requested_at,decided_at')
    .eq('affiliate_id', user.id).order('requested_at', { ascending: false }).limit(200)
  return (data ?? []).map(({ proof_path, ...w }) => ({ ...w, amount: Number(w.amount), hasProof: !!proof_path }))
})
