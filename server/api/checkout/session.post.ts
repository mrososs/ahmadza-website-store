import { checkoutSessionSchema } from '~~/shared/schemas/commerce'
import { AFFILIATE_COOKIE } from '~~/shared/constants'
import { getProvider, loadPaymentSettings } from '~~/server/services/payments'

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

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit(event, 'checkout', 20, 60_000)
  const parsed = checkoutSessionSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('السلة غير صالحة')

  const config = useRuntimeConfig(event)
  const provider = getProvider(String(config.paymentProvider))
  const settings = await loadPaymentSettings(event)
  provider.assertAvailable(settings, config) // production / disabled / not-integrated gateways stop here

  // Attribution comes from the first-party cookie only — never from the request body.
  const ref = getCookie(event, AFFILIATE_COOKIE)
  const affiliate = ref && UUID.test(ref) ? ref.toLowerCase() : null

  const { data, error } = await serviceClient(event).rpc('create_payment_for_cart', {
    p_user: user.id, p_book_ids: parsed.data.bookIds, p_affiliate: affiliate as string, p_provider: provider.id, p_mode: provider.mode(settings),
  })
  if (error) throw purchaseError(error)
  const payment = data as unknown as { id: string; reference: string; amount: number; currency: string }
  const { redirectUrl } = await provider.createSession(payment)
  return { reference: payment.reference, amount: Number(payment.amount), currency: payment.currency, redirectUrl }
})
