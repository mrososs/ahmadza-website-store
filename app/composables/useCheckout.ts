import type { QuoteResponse } from '~~/shared/schemas/commerce'

/**
 * Cart <-> server glue. The cart store only holds ids; every price, the total and the payment itself are
 * produced by /api/cart/quote and /api/checkout/session (database-priced).
 */
export function useCheckout() {
  const cart = useCartStore()
  const quote = ref<QuoteResponse | null>(null)
  const loading = ref(false)
  const error = ref('')
  const notices = ref<string[]>([])

  async function refreshQuote() {
    error.value = ''
    if (!cart.ids.length) { quote.value = null; return }
    loading.value = true
    try {
      const q = await $fetch<QuoteResponse>('/api/cart/quote', { method: 'POST', body: { bookIds: cart.ids } })
      // books that are no longer sellable (unpublished / free) or already owned drop out of the cart
      const stale = [...q.unavailable, ...q.owned]
      if (q.unavailable.length) notices.value.push('تمت إزالة كتب لم تعد متاحة للشراء من السلة')
      if (q.owned.length) notices.value.push('تمت إزالة كتب موجودة بالفعل في مكتبتك')
      stale.forEach((id) => cart.remove(id))
      quote.value = q
    } catch { error.value = 'تعذر تحميل السلة، حاول مرة أخرى' } finally { loading.value = false }
  }

  /** Creates the payment server-side and returns where the browser must go next. */
  async function startPayment(): Promise<{ ok: true; redirectUrl: string } | { ok: false; message: string }> {
    try {
      const r = await $fetch<{ redirectUrl: string }>('/api/checkout/session', { method: 'POST', body: { bookIds: cart.ids } })
      return { ok: true, redirectUrl: r.redirectUrl }
    } catch (e) {
      const err = e as { statusCode?: number; data?: { message?: string; statusMessage?: string } }
      if (err.statusCode === 401) return { ok: false, message: 'سجّل الدخول لإتمام الشراء' }
      return { ok: false, message: err.data?.message || err.data?.statusMessage || 'تعذر بدء عملية الدفع' }
    }
  }

  return { quote, loading, error, notices, refreshQuote, startPayment }
}
