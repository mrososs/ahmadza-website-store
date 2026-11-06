import { defineStore } from 'pinia'
import { CART_STORAGE_KEY, MAX_CART_ITEMS } from '~~/shared/constants'

/**
 * Cart = list of book ids only (legacy parity: one unit per book, server-side prices — rule ORD-*).
 * Nothing price-related is stored or trusted client-side; checkout re-reads prices in the database.
 */
export const useCartStore = defineStore('cart', () => {
  const ids = ref<number[]>([])
  const hydrated = ref(false)

  function persist() {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(ids.value)) } catch { /* private mode: cart lives in memory only */ }
  }
  function hydrate() {
    if (hydrated.value || !import.meta.client) return
    try {
      const raw = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]')
      ids.value = Array.isArray(raw) ? [...new Set<number>(raw.filter((n: unknown) => Number.isInteger(n) && (n as number) > 0))].slice(0, MAX_CART_ITEMS) : []
    } catch { ids.value = [] }
    hydrated.value = true
  }

  const count = computed(() => ids.value.length)
  const has = (id: number) => ids.value.includes(id)
  function add(id: number) {
    if (has(id) || ids.value.length >= MAX_CART_ITEMS) return false // duplicate prevention
    ids.value = [...ids.value, id]
    persist()
    return true
  }
  function remove(id: number) { ids.value = ids.value.filter((x) => x !== id); persist() }
  function clear() { ids.value = []; persist() }

  return { ids, count, hydrated, has, add, remove, clear, hydrate }
})
