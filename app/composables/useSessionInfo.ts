import type { SessionInfo } from '~~/shared/types/app'

/**
 * Auth-dependent UI is resolved on the client after hydration only, so public pages that are served from a
 * shared SSR cache never contain personalised markup (see routeRules in nuxt.config.ts).
 */
export function useSessionInfo() {
  const user = useSupabaseUser()
  const client = useSupabaseClient()
  const mounted = useState('session-mounted', () => false)
  const info = useState<SessionInfo | null>('session-info', () => null)

  async function refresh() {
    const id = user.value?.id ?? (user.value as { sub?: string } | null)?.sub
    if (!id) { info.value = null; return }
    const [{ data: profile }, { data: isAdmin }] = await Promise.all([
      client.from('profiles').select('display_name,is_affiliate').eq('id', id).maybeSingle(),
      client.rpc('is_admin'),
    ])
    info.value = {
      id,
      email: (user.value as { email?: string } | null)?.email ?? null,
      displayName: profile?.display_name ?? '',
      isAffiliate: !!profile?.is_affiliate,
      isAdmin: isAdmin === true,
    }
  }

  if (import.meta.client) {
    onMounted(() => { mounted.value = true; void refresh() })
    watch(() => user.value, () => { if (mounted.value) void refresh() })
  }

  const isAuthed = computed(() => mounted.value && !!info.value)

  async function logout() {
    await client.auth.signOut()
    info.value = null
    await navigateTo('/')
  }

  return { info, isAuthed, mounted, refresh, logout }
}
