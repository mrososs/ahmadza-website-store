import { requireAdmin, serviceClient } from '../../../utils/supabase'

// Contributor submissions for review (document paths are never returned — see the signed-URL document route).
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const status = getQuery(event).status
  let q = serviceClient(event).from('contributor_requests')
    .select('id,title,deal,cost,currency,whatsapp,status,created_at,book_id,user_id,profiles!contributor_requests_user_id_fkey(display_name)')
    .order('created_at', { ascending: false }).limit(500)
  if (status === 'pending' || status === 'approved' || status === 'declined') q = q.eq('status', status)
  const { data } = await q
  return ((data ?? []) as unknown as { cost: number | null; profiles: { display_name: string } | null }[]).map(({ profiles, ...r }) => ({
    ...r, cost: r.cost == null ? null : Number(r.cost), ownerName: profiles?.display_name ?? '',
  }))
})
