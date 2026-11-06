// Named middleware 'guest': signed-in users are bounced away from login/register pages.
export default defineNuxtRouteMiddleware((to) => {
  const user = useSupabaseUser()
  if (!user.value) return
  const redirect = typeof to.query.redirect === 'string' && to.query.redirect.startsWith('/') && !to.query.redirect.startsWith('//')
    ? to.query.redirect : '/'
  return navigateTo(redirect)
})
