import { requireAdmin, serviceClient } from '../../../utils/supabase'

// All withdrawal requests with the payout details the admin needs to make the transfer.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const status = getQuery(event).status
  const db = serviceClient(event)
  let q = db.from('withdrawal_requests')
    .select('id,affiliate_id,amount,currency,status,payout_kind,note,proof_path,requested_at,decided_at,profiles!withdrawal_requests_affiliate_id_fkey(display_name)')
    .order('requested_at', { ascending: false }).limit(500)
  if (status === 'pending' || status === 'paid' || status === 'rejected') q = q.eq('status', status)
  const { data } = await q
  const rows = (data ?? []) as unknown as { affiliate_id: string; proof_path: string | null; amount: number; profiles: { display_name: string } | null }[]
  const ids = [...new Set(rows.map((r) => r.affiliate_id))]
  const { data: payout } = ids.length ? await db.from('payout_methods').select('affiliate_id,kind,details').in('affiliate_id', ids) : { data: [] }
  return rows.map(({ proof_path, profiles, ...w }) => ({
    ...w, amount: Number(w.amount), affiliateName: profiles?.display_name ?? '', hasProof: !!proof_path,
    payout: (payout ?? []).filter((p) => p.affiliate_id === w.affiliate_id).map((p) => ({ kind: p.kind, details: p.details })),
  }))
})
