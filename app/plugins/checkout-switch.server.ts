// A protected preview switches checkout off: /api/checkout/methods answers 503 there by design. The server knows that on EVERY render (not only on pages that happen
// to show the footer), so it tells the browser through the payload and the browser never sends a request that is certain to fail. Same rule as the gate: only an
// explicit `open` unprotects the site.
export default defineNuxtPlugin(() => {
  const off = useState<boolean>('checkout-switched-off', () => false)
  off.value = String(useRuntimeConfig().previewMode ?? '').trim().toLowerCase() !== 'open'
})
