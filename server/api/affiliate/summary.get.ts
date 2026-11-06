import { fromDbError } from '../../utils/errors'
import { requireAffiliate, serviceClient } from '../../utils/supabase'

// Dashboard numbers. Balances come from the append-only ledger (affiliate_balance), never from a stored column.
// Commission %, freeze days and minimum withdrawal are site_settings values (pending owner confirmation).
export default defineEventHandler(async (event) => {
  const user = await requireAffiliate(event)
  const db = serviceClient(event)

  const [{ data: bal, error: balErr }, { data: set }] = await Promise.all([
    db.rpc('affiliate_balance', { p_affiliate: user.id }),
    db.from('site_settings')
      .select('affiliate_commission_percent,commission_freeze_days,min_withdrawal_amount,base_currency,allow_test_payments,pending_owner_confirmation')
      .eq('id', 1).single(),
  ])
  if (balErr) throw fromDbError(balErr)
  const b = (bal as { available: number; frozen: number; pending_withdrawal: number; paid_out: number; currency: string }[] | null)?.[0]

  let q = db.from('affiliate_commissions').select('amount,created_at,is_test').eq('affiliate_id', user.id)
  if (!set?.allow_test_payments) q = q.eq('is_test', false)
  const { data: comms } = await q
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
  const today = (comms ?? []).filter((c) => new Date(c.created_at) >= startOfToday)
  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + Number(r.amount), 0)

  return {
    balance: {
      available: Number(b?.available ?? 0), frozen: Number(b?.frozen ?? 0),
      pendingWithdrawal: Number(b?.pending_withdrawal ?? 0), paidOut: Number(b?.paid_out ?? 0),
      currency: b?.currency ?? set?.base_currency ?? 'USD',
    },
    stats: {
      orders: comms?.length ?? 0, earned: sum(comms ?? []),
      ordersToday: today.length, earnedToday: sum(today),
    },
    settings: {
      commissionPercent: Number(set?.affiliate_commission_percent ?? 0),
      freezeDays: set?.commission_freeze_days ?? 0,
      minWithdrawal: Number(set?.min_withdrawal_amount ?? 0),
      pendingOwnerConfirmation: set?.pending_owner_confirmation ?? [],
      testMode: !!set?.allow_test_payments,
    },
  }
})
