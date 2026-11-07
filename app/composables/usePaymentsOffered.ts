/**
 * Whether at least one payment method can really be used right now (the server answers from its own configuration). The "payment methods" logos and any other
 * promise of card payment are shown only when this is true. It starts false on the server and on first render, so the page never claims a method it cannot honour,
 * and server and browser render the same markup (no hydration mismatch). The protected preview answers 503 here, so nothing is promised there either.
 */
export function usePaymentsOffered() {
  const offered = useState<boolean>('payments-offered', () => false)
  const asked = useState<boolean>('payments-offered-asked', () => false)
  // A protected preview switches checkout off (the endpoint answers 503). The server knows that, so the browser is not sent to discover it with a failing request on every page.
  if (import.meta.server && !asked.value && String(useRuntimeConfig().previewMode ?? '').trim().toLowerCase() !== 'open') asked.value = true
  if (import.meta.client && !asked.value) {
    asked.value = true
    $fetch<{ methods: { available: boolean }[] }>('/api/checkout/methods')
      .then((r) => { offered.value = r.methods.some((m) => m.available) })
      .catch(() => { offered.value = false })
  }
  return offered
}
