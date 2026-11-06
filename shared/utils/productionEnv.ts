// Production configuration checks. Pure, so they can be tested; server/plugins/01-production-env-check.ts runs them at start-up.
// ERRORS stop the server from starting (it would be broken or unsafe in a way nobody would notice). WARNINGS are logged: they are legitimate but risky choices.
export interface EnvFinding { code: string; message: string }
export interface EnvReport { errors: EnvFinding[]; warnings: EnvFinding[] }

const truthy = (v: unknown) => v === true || String(v ?? '').trim().toLowerCase() === 'true'
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const isLocalHost = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u)

/** @param cfg the runtimeConfig object (server side, so server-only keys are present). */
export function checkProductionEnv(cfg: Record<string, unknown> & { public?: Record<string, unknown> }, production: boolean): EnvReport {
  const errors: EnvFinding[] = [], warnings: EnvFinding[] = []
  const E = (code: string, message: string) => errors.push({ code, message })
  const W = (code: string, message: string) => warnings.push({ code, message })
  if (!production) return { errors, warnings }

  const site = text(cfg.public?.siteUrl)
  if (!site) E('site_url_missing', 'NUXT_PUBLIC_SITE_URL is not set: links, canonical URLs and e-mail redirects would be wrong')
  else if (isLocalHost(site)) E('site_url_local', `NUXT_PUBLIC_SITE_URL points at ${site}: set the real https origin`)
  else if (!site.startsWith('https://')) E('site_url_not_https', 'NUXT_PUBLIC_SITE_URL must be an https URL in production')

  if (!text((cfg.public as { supabase?: { url?: unknown } } | undefined)?.supabase?.url)) E('supabase_url_missing', 'NUXT_PUBLIC_SUPABASE_URL is not set')
  const sb = cfg.supabase as { serviceKey?: unknown; secretKey?: unknown } | undefined
  if (!text(sb?.secretKey) && !text(sb?.serviceKey) && !text(process.env.NUXT_SUPABASE_SECRET_KEY)) E('supabase_secret_missing', 'NUXT_SUPABASE_SECRET_KEY is not set: every server route would fail')

  const mode = text(cfg.previewMode).toLowerCase()
  const protectedMode = mode !== 'open'
  if (protectedMode && (!text(cfg.previewUser) || !text(cfg.previewPasswordHash))) {
    W('preview_without_credentials', 'the preview is protected but NUXT_PREVIEW_USER / NUXT_PREVIEW_PASSWORD_HASH are missing: the site answers 503 to every request until they are set')
  }
  if (mode === 'open') W('site_is_public', 'NUXT_PREVIEW_MODE=open: the site is served without a password')
  if (!truthy(cfg.adminRequireMfa)) W('admin_mfa_off', 'NUXT_ADMIN_REQUIRE_MFA is not true: administrators are not asked for a second factor')
  if (truthy(cfg.allowDevPaymentSimulator)) W('simulator_enabled', 'the development payment simulator is enabled in production (it still refuses to run)')

  const enabled = text(cfg.paymentsEnabledProviders).split(',').map((s) => s.trim()).filter(Boolean)
  if (enabled.includes('dev_simulator')) W('simulator_listed', 'dev_simulator is listed in NUXT_PAYMENTS_ENABLED_PROVIDERS in production')
  const gateways = enabled.filter((p) => p === 'paymob' || p === 'tap')
  if (gateways.length) {
    const origin = text(cfg.paymentsPublicBaseUrl) || site
    if (!origin.startsWith('https://')) W('payments_origin_not_https', 'payment gateways are enabled but NUXT_PAYMENTS_PUBLIC_BASE_URL (or the site URL) is not https: callbacks cannot reach this server')
  }
  if (truthy(cfg.paymentsLiveEnabled)) {
    const verified = [enabled.includes('paymob') && truthy(cfg.paymobVerified), enabled.includes('tap') && truthy(cfg.tapVerified)].some(Boolean)
    if (!verified) W('live_without_verified_gateway', 'NUXT_PAYMENTS_LIVE_ENABLED is true but no enabled gateway is attested as verified: live payments stay refused')
  }
  return { errors, warnings }
}
