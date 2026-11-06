import { checkoutSessionSchema } from '~~/shared/schemas/commerce'
import { AFFILIATE_COOKIE } from '~~/shared/constants'
import { chooseProvider, loadPaymentSettings } from '~~/server/services/payments'
import { callbackOrigin } from '~~/server/services/payments/config'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** DB error text -> user-facing Arabic message (the SQL function is the authority; this only translates). */
function purchaseError(err: { code?: string; message?: string }) {
  const m = err.message ?? ''
  if (m.includes('not allowed to purchase')) return forbidden('هذا الحساب غير مسموح له بالشراء حالياً')
  if (m.includes('already in the library')) return createError({ statusCode: 409, statusMessage: 'أحد الكتب موجود بالفعل في مكتبتك' })
  if (m.includes('unavailable')) return createError({ statusCode: 409, statusMessage: 'أحد الكتب غير متاح للشراء' })
  if (m.includes('disabled')) return forbidden('الدفع التجريبي غير مفعّل')
  return fromDbError(err)
}

// Creates the payment SERVER-SIDE from book ids only: the price comes from the database, the browser's totals are never read. Then asks the chosen
// gateway for a hosted checkout session and stores the gateway's own order id on the payment, which is what later callbacks are bound to.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit(event, 'checkout', 20, 60_000)
  const parsed = checkoutSessionSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('السلة غير صالحة')

  const config = useRuntimeConfig(event)
  const settings = await loadPaymentSettings(event)
  const provider = chooseProvider(parsed.data.provider, settings, config)
  provider.assertAvailable(settings, config) // disabled / not configured / live not allowed / currency mismatch stop here

  // Attribution comes from the first-party cookie only — never from the request body.
  const ref = getCookie(event, AFFILIATE_COOKIE)
  const affiliate = ref && UUID.test(ref) ? ref.toLowerCase() : null

  const db = serviceClient(event)
  const { data, error } = await db.rpc('create_payment_for_cart', {
    p_user: user.id, p_book_ids: parsed.data.bookIds, p_affiliate: affiliate as string, p_provider: provider.id, p_mode: provider.mode(settings),
  })
  if (error) throw purchaseError(error)
  const payment = data as unknown as { id: string; reference: string; amount: number; currency: string; mode: 'live' | 'test'; cart_snapshot: { title: string; unit_price: number }[] }

  const { data: profile } = await db.from('profiles').select('display_name,phone,country_code').eq('id', user.id).maybeSingle()
  const phone = profile?.phone ? `+${(profile.country_code ?? '').replace(/\D+/g, '')}${profile.phone.replace(/\D+/g, '')}` : null
  const origin = callbackOrigin(config, config.public.siteUrl)
  try {
    const session = await provider.createSession({
      payment: { id: payment.id, reference: payment.reference, amount: Number(payment.amount), currency: payment.currency, mode: payment.mode },
      items: payment.cart_snapshot.map((i) => ({ name: i.title, amount: Number(i.unit_price) })),
      customer: { name: profile?.display_name || 'Customer', email: user.email ?? '', phone: phone && phone.length > 6 ? phone : null },
      urls: { webhook: `${origin}/api/webhooks/payments/${provider.id}`, redirect: `${origin}/api/checkout/return/${provider.id}?reference=${payment.reference}` },
    }, config)
    if (session.providerOrderId) await db.rpc('attach_provider_session', { p_payment_id: payment.id, p_provider_order_id: session.providerOrderId })
    return { reference: payment.reference, amount: Number(payment.amount), currency: payment.currency, redirectUrl: session.redirectUrl, provider: provider.id }
  } catch (e) {
    // no dangling pending payment when the gateway could not start a session
    await db.rpc('fail_payment', { p_payment_id: payment.id, p_status: 'failed', p_raw: { session_error: true } })
    throw e
  }
})
