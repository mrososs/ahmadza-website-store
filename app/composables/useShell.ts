import { shellData } from '~~/shared/queries/catalog'
import type { Database } from '~~/shared/types/database.types'

/** Site-wide data for header/footer/sidebar/statistics (public, cache-safe). */
export function useShell() {
  const client = useSupabaseClient<Database>()
  return useAsyncData('shell', () => shellData(client), { default: () => null })
}
