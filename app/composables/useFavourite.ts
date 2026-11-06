import { isFavourite, setFavourite } from '~~/shared/queries/storefront'
import type { Database } from '~~/shared/types/database.types'

/** Favourite toggle for a book/article. Guests are sent to login (RLS enforces ownership on the database side). */
export function useFavourite(kind: 'book' | 'article', id: number) {
  const client = useSupabaseClient<Database>()
  const { info, mounted } = useSessionInfo()
  const liked = ref(false)
  const busy = ref(false)

  watch([() => mounted.value, () => info.value?.id], async ([m, uid]) => {
    liked.value = m && uid ? await isFavourite(client, kind, id).catch(() => false) : false
  }, { immediate: true })

  async function toggle() {
    if (!info.value) return navigateTo({ path: '/login', query: { redirect: useRoute().fullPath } })
    if (busy.value) return
    busy.value = true
    try {
      await setFavourite(client, info.value.id, kind, id, !liked.value)
      liked.value = !liked.value
    } finally { busy.value = false }
  }
  return { liked, busy, toggle }
}
