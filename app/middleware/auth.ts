// Named middleware 'auth': guests are sent to /login?redirect=<current path>. Real authorisation is always re-checked server-side.
export default defineNuxtRouteMiddleware(async (to) => {
  const user = useSupabaseUser()
  if (user.value) return
  // the SSR session cookie is resolved by the supabase module; on the client wait for the session once
  if (import.meta.client) {
    const { data } = await useSupabaseClient().auth.getSession()
    if (data.session) return
  }
  return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})
