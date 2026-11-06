// Named middleware 'admin': requires public.is_admin() (database-managed role) and, where the server requires it, a completed second factor.
// UX guard only — every /api/admin route re-checks with requireAdmin() on the server (role AND aal2).
export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  const { data } = await useSupabaseClient().rpc('is_admin')
  if (data !== true) return navigateTo('/')

  // Second factor. Once satisfied in this browser session the answer is remembered; it is re-asked while it is not.
  const satisfied = useState<boolean>('admin-mfa-satisfied', () => false)
  if (!satisfied.value) {
    try {
      const me = await $fetch<{ mfa: { required: boolean; satisfied: boolean } }>('/api/admin/me')
      satisfied.value = me.mfa.satisfied
    } catch { return navigateTo('/admin/login') }
    if (!satisfied.value && to.path !== '/admin/security') return navigateTo('/admin/security')
  }
})
