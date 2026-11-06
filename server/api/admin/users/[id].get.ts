import { notFound } from '../../../utils/errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ADM-03: user details (profile, auth e-mail, orders, entitlements).
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const id = event.context.params?.id ?? ''
  if (!UUID.test(id)) throw badRequest('معرّف غير صالح')
  const db = serviceClient(event)
  const { data: profile } = await db.from('profiles').select('id,display_name,phone,country,region,status,is_affiliate,created_at,deleted_at').eq('id', id).maybeSingle()
  if (!profile) throw notFound('المستخدم غير موجود')
  const [{ data: auth }, orders, ents] = await Promise.all([
    db.auth.admin.getUserById(id),
    db.from('orders').select('id,order_no,status,mode,total_amount,currency,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    db.from('entitlements').select('id,book_id,is_test,granted_at,revoked_at,books(title)').eq('user_id', id).order('granted_at', { ascending: false }).limit(100),
  ])
  return {
    ...profile,
    email: auth?.user?.email ?? null,
    email_confirmed: !!auth?.user?.email_confirmed_at,
    last_sign_in_at: auth?.user?.last_sign_in_at ?? null,
    orders: orders.data ?? [],
    entitlements: ents.data ?? [],
  }
})
