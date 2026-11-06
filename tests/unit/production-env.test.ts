import { describe, expect, it } from 'vitest'
import { checkProductionEnv } from '../../shared/utils/productionEnv'

const good = () => ({
  public: { siteUrl: 'https://preview.example.com', supabase: { url: 'https://abcdefghijklmnopqrst.supabase.co' } },
  supabase: { secretKey: 'sb_secret_x' },
  previewMode: 'protected', previewUser: 'client', previewPasswordHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
  adminRequireMfa: true, allowDevPaymentSimulator: false, paymentsEnabledProviders: '', paymentsLiveEnabled: false,
}) as Record<string, unknown> & { public: Record<string, unknown> }
const codes = (r: ReturnType<typeof checkProductionEnv>) => ({ e: r.errors.map((x) => x.code), w: r.warnings.map((x) => x.code) })

describe('production environment check', () => {
  it('a correctly configured protected preview has neither errors nor warnings', () => {
    expect(codes(checkProductionEnv(good(), true))).toEqual({ e: [], w: [] })
  })
  it('does nothing outside production', () => {
    expect(checkProductionEnv({ public: {} }, false)).toEqual({ errors: [], warnings: [] })
  })
  it('refuses a missing, local or non-https site URL', () => {
    for (const siteUrl of ['', 'http://127.0.0.1:3000', 'http://localhost:3000', 'http://shop.example.com']) {
      const c = good(); c.public.siteUrl = siteUrl
      expect(checkProductionEnv(c, true).errors.length, siteUrl).toBeGreaterThan(0)
    }
  })
  it('refuses to start without the Supabase URL or the server secret key', () => {
    const noUrl = good(); noUrl.public.supabase = {}
    expect(codes(checkProductionEnv(noUrl, true)).e).toContain('supabase_url_missing')
    const noKey = good(); noKey.supabase = {}
    const saved = process.env.NUXT_SUPABASE_SECRET_KEY; delete process.env.NUXT_SUPABASE_SECRET_KEY
    try { expect(codes(checkProductionEnv(noKey, true)).e).toContain('supabase_secret_missing') } finally { if (saved) process.env.NUXT_SUPABASE_SECRET_KEY = saved }
  })
  it('warns (does not refuse) about a protected preview with no credentials, a public site, admin MFA off and the simulator', () => {
    const c = good(); c.previewUser = ''; c.adminRequireMfa = false; c.allowDevPaymentSimulator = true; c.paymentsEnabledProviders = 'dev_simulator'
    const r = codes(checkProductionEnv(c, true))
    expect(r.e).toEqual([])
    expect(r.w).toEqual(expect.arrayContaining(['preview_without_credentials', 'admin_mfa_off', 'simulator_enabled', 'simulator_listed']))
    const open = good(); open.previewMode = 'open'
    expect(codes(checkProductionEnv(open, true)).w).toContain('site_is_public')
  })
  it('refuses a protected preview on Vercel that was built with shared page caching, because the edge would serve pages without the password gate', () => {
    const c = good(); c.previewBuildCachesPages = true
    expect(codes(checkProductionEnv(c, true, { vercel: true })).e).toContain('protected_build_has_page_caching')
    expect(codes(checkProductionEnv(c, true)).e).not.toContain('protected_build_has_page_caching') // other hosts apply swr inside the app, after the gate
    c.previewBuildCachesPages = false
    expect(codes(checkProductionEnv(c, true, { vercel: true })).e).toEqual([])
    const open = good(); open.previewMode = 'open'; open.previewBuildCachesPages = true
    expect(codes(checkProductionEnv(open, true, { vercel: true })).e).toEqual([]) // a deliberate public launch may cache
  })
  it('warns when an enabled gateway has no confirmed account currency (it would silently never be offered)', () => {
    const c = good(); c.paymentsEnabledProviders = 'paymob,tap'; c.paymentsPublicBaseUrl = 'https://preview.example.com'
    expect(codes(checkProductionEnv(c, true)).w).toEqual(expect.arrayContaining(['paymob_currency_unconfirmed', 'tap_currency_unconfirmed']))
    c.paymobCurrency = 'USD'; c.tapCurrency = 'USD'
    expect(codes(checkProductionEnv(c, true)).w).toEqual([])
  })
  it('warns when payment gateways cannot be reached by their callbacks, and when live is on without an attested gateway', () => {
    const c = good(); c.paymentsEnabledProviders = 'paymob,tap'; c.paymentsPublicBaseUrl = 'http://internal.example'; c.paymentsLiveEnabled = true
    const r = codes(checkProductionEnv(c, true))
    expect(r.w).toEqual(expect.arrayContaining(['payments_origin_not_https', 'live_without_verified_gateway']))
    c.paymobVerified = true
    expect(codes(checkProductionEnv(c, true)).w).not.toContain('live_without_verified_gateway')
  })
})
