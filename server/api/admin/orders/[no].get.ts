import { notFound } from '../../../utils/errors'

export default defineEventHandler(async (event) => {
  await adminRead(event)
  const no = intParam(event, 'no')
  const db = serviceClient(event)
  const { data: order } = await db.from('orders')
    .select('id,order_no,status,mode,total_amount,currency,created_at,user_id,affiliate_id,payment_id,legacy_order_id,profiles!orders_user_id_fkey(display_name)')
    .eq('order_no', no).maybeSingle()
  if (!order) throw notFound('الفاتورة غير موجودة')
  const [items, payment, auth] = await Promise.all([
    db.from('order_items').select('id,book_id,title_snapshot,unit_price').eq('order_id', order.id).order('id'),
    order.payment_id ? db.from('payments').select('id,reference,provider,status,amount,currency,mode,paid_at').eq('id', order.payment_id).maybeSingle() : Promise.resolve({ data: null }),
    db.auth.admin.getUserById(order.user_id),
  ])
  return { ...order, email: auth.data?.user?.email ?? null, items: items.data ?? [], payment: payment.data }
})
