import { AFFILIATE_COOKIE, AFFILIATE_COOKIE_DAYS } from '~~/shared/constants'

// Referral attribution: ?aff=<affiliate profile id> is remembered in a first-party cookie. The checkout server route
// reads this cookie itself (the browser can never submit a commission amount or an affiliate id in the body).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default defineNuxtRouteMiddleware((to) => {
  const ref = typeof to.query.aff === 'string' ? to.query.aff : null
  if (ref && UUID.test(ref)) {
    const cookie = useCookie(AFFILIATE_COOKIE, { maxAge: AFFILIATE_COOKIE_DAYS * 86400, sameSite: 'lax', path: '/' })
    cookie.value = ref.toLowerCase()
  }
})
