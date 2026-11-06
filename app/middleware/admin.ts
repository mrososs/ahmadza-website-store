// Named middleware 'admin': requires public.is_admin() (database-managed role). UX guard only — every /api/admin route
// re-checks with requireAdmin() on the server.
export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  const { data } = await useSupabaseClient().rpc('is_admin')
  if (data !== true) return navigateTo('/')
})
