import { fromDbError, notFound } from '../../../utils/errors'
import { requireAdmin, serviceClient } from '../../../utils/supabase'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Admin affiliate profile: balances, commissions, withdrawals and payout details (payout details are admin-visible
// only so a payout can be made — they are sensitive and never returned to other users).
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!UUID.test(id)) throw notFound()
  const db = serviceClient(event)

  const { data: profile } = await db.from('profiles').select('id,display_name,phone,country,status,is_affiliate,created_at').eq('id', id).maybeSingle()
  if (!profile || !profile.is_affiliate) throw notFound('المسوّق غير موجود')
  const [{ data: authUser }, { data: bal, error }, { data: commissions }, { data: withdrawals }, { data: payout }, { data: ref }] = await Promise.all([
    db.auth.admin.getUserById(id),
    db.rpc('affiliate_balance', { p_affiliate: id }),
    db.from('affiliate_commissions').select('id,amount,currency,percent,gross_amount,available_at,is_test,created_at,orders(order_no)').eq('affiliate_id', id).order('created_at', { ascending: false }).limit(100),
    db.from('withdrawal_requests').select('id,amount,currency,status,note,proof_path,requested_at,decided_at').eq('affiliate_id', id).order('requested_at', { ascending: false }).limit(100),
    db.from('payout_methods').select('kind,details,is_active').eq('affiliate_id', id),
    db.from('orders').select('id', { count: 'exact', head: true }).eq('affiliate_id', id),
  ])
  if (error) throw fromDbError(error)
  void ref
  const b = (bal as { available: number; frozen: number; pending_withdrawal: number; paid_out: number }[] | null)?.[0]
  return {
    profile: { ...profile, email: authUser?.user?.email ?? null },
    balance: { available: Number(b?.available ?? 0), frozen: Number(b?.frozen ?? 0), pending: Number(b?.pending_withdrawal ?? 0), paidOut: Number(b?.paid_out ?? 0) },
    commissions: (commissions ?? []).map((c) => ({ ...c, amount: Number(c.amount), gross_amount: Number(c.gross_amount), percent: Number(c.percent) })),
    withdrawals: (withdrawals ?? []).map(({ proof_path, ...w }) => ({ ...w, amount: Number(w.amount), hasProof: !!proof_path })),
    payoutMethods: payout ?? [],
  }
})
