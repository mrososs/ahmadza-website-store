// AAWRAQ platform — Nuxt 4 application (storefront + account + affiliate + admin in one deployment).
const isProd = process.env.NODE_ENV === 'production'
// A PROTECTED production build (the default; see server/utils/previewGate.ts) must carry NO shared-cache rules: on a platform such as Vercel an `swr` rule becomes an edge-cached page that is
// served WITHOUT running the password gate. Only a build made with NUXT_PREVIEW_MODE=open (a public launch) or a development server gets the public-page caching below.
const cachePublicPages = !isProd || (process.env.NUXT_PREVIEW_MODE ?? '').trim().toLowerCase() === 'open'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/supabase', '@pinia/nuxt'],
  typescript: { strict: true, typeCheck: false },

  // Keep each page's data INLINE in its own HTML. With extraction on, `/_payload.json` is a separate response (and, under the
  // `swr` rules below, a separate cache entry), so the HTML and the data the browser hydrates from could be produced at
  // different moments: any catalogue change in between made the client render differ from the server HTML (hydration
  // mismatch; measured 39/40 page loads while data changed, 0/50 when it did not). Inline payloads are always consistent.
  experimental: { payloadExtraction: false },

  // The legacy stylesheets are linked from the layouts (same order as the Blade masters) so their
  // relative font/image URLs keep working. See app/layouts and docs/implementation/05-legacy-ui-fidelity.md.
  css: [],

  // Flat component names (SiteHeader, BookCard…): folders only group files by feature.
  components: [{ path: '~/components', pathPrefix: false }],

  app: {
    head: {
      htmlAttrs: { lang: 'ar', dir: 'rtl' },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      title: 'أوراق عربية',
      titleTemplate: '%s - أوراق عربية',
      link: [{ rel: 'icon', href: '/images/icons/icon-192x192.png' }],
    },
  },

  supabase: {
    // Route protection is done by our own middleware (app/middleware) + server-side checks, not by the module redirect.
    redirect: false,
    types: '~~/shared/types/database.types.ts',
    cookieOptions: { maxAge: 60 * 60 * 8, sameSite: 'lax', secure: isProd },
  },

  runtimeConfig: {
    // server-only
    // Administrators must pass a second factor (TOTP, Supabase Auth aal2) to use /api/admin/**. Production default true (NUXT_ADMIN_REQUIRE_MFA); local development false.
    adminRequireMfa: process.env.NODE_ENV === 'production',
    previewBuildCachesPages: isProd && cachePublicPages, // read at start-up: a protected deployment built WITH page caching is refused on Vercel (see shared/utils/productionEnv.ts)
    // ---- payments (server-only; credentials ONLY from the environment, never the database or the browser). See docs/implementation/PAYMENTS_GO_LIVE_CHECKLIST.md
    paymentProvider: '', // optional default (paymob | tap | dev_simulator); empty = the first available enabled provider (legacy default order: Paymob, then Tap)
    // which providers may be offered at all (override NUXT_PAYMENTS_ENABLED_PROVIDERS). Production never lists the simulator by default.
    paymentsEnabledProviders: process.env.NODE_ENV === 'production' ? 'paymob,tap' : 'dev_simulator,paymob,tap',
    paymentsLiveEnabled: false, // NUXT_PAYMENTS_LIVE_ENABLED=true is the owner's explicit switch; live ALSO needs the provider's *_VERIFIED=true
    paymentsPublicBaseUrl: '', // https origin the gateways call back to (NUXT_PAYMENTS_PUBLIC_BASE_URL); falls back to NUXT_PUBLIC_SITE_URL
    // Paymob (KSA). Test and live key sets are separate; the active set follows site_settings.payment_mode.
    paymobRegion: 'ksa', // the regional Paymob account: ksa | egypt | uae | oman (legacy store: KSA). Base and checkout hosts follow it unless the two URLs below are set
    paymobBaseUrl: '', paymobCheckoutUrl: '',
    paymobCurrency: '', // REQUIRED confirmation of the currency the integration charges in: must equal the store currency (no conversion is ever applied); empty = Paymob unavailable
    paymobFallbackPhone: '', paymobVerified: false,
    paymobTestSecretKey: '', paymobTestPublicKey: '', paymobTestHmacSecret: '', paymobTestIntegrationIds: '',
    paymobLiveSecretKey: '', paymobLivePublicKey: '', paymobLiveHmacSecret: '', paymobLiveIntegrationIds: '',
    // Tap
    tapBaseUrl: 'https://api.tap.company/v2', tapCurrency: '', // tapCurrency: REQUIRED confirmation of the currency the merchant account charges in (must equal the store currency); empty = Tap unavailable
    tapMerchantId: '', tapVerified: false,
    tapTestSecretKey: '', tapLiveSecretKey: '',
    allowDevPaymentSimulator: process.env.NODE_ENV !== 'production',
    signedUrlTtlSeconds: 120,
    // Protected client preview (server/utils/previewGate.ts): in production the site is PROTECTED unless NUXT_PREVIEW_MODE=open is set explicitly.
    // Credentials: NUXT_PREVIEW_USER + NUXT_PREVIEW_PASSWORD_HASH (made with scripts/preview/hash-password.mjs). Missing credentials => nothing is served.
    previewMode: process.env.NODE_ENV === 'production' ? 'protected' : 'open',
    previewUser: '',
    previewPasswordHash: '',
    // Which media backends may serve/accept files in THIS environment (override: NUXT_MEDIA_ENABLED_PROVIDERS).
    // Local dev: Supabase Storage + external links. Hosted/production default: external links only; add `vps` only after the
    // private media service passed its security gate (docs/implementation/VPS_SECURITY_GATE.md).
    mediaEnabledProviders: process.env.NODE_ENV === 'production' ? 'external' : 'supabase,external',
    // private media service (services/media-server); overrides: NUXT_VPS_STORAGE_BASE_URL / _SIGNING_SECRET / _UPLOAD_TOKEN. Never public.
    vpsStorageBaseUrl: '',
    vpsStorageSigningSecret: '',
    vpsStorageUploadToken: '',
    public: {
      siteUrl: 'http://127.0.0.1:3000',
    },
  },

  routeRules: {
    // public SEO pages: SSR with a short shared cache. Personalised content is never rendered server-side into these.
    ...(cachePublicPages ? { '/': { swr: 60 }, '/book/**': { swr: 60 }, '/post/**': { swr: 120 }, '/p/**': { swr: 300 } } : {}),
    // personalised areas: never cached by a shared cache
    '/cart': { headers: { 'cache-control': 'private, no-store' } },
    '/library': { headers: { 'cache-control': 'private, no-store' } },
    '/favourites': { headers: { 'cache-control': 'private, no-store' } },
    '/invoices/**': { headers: { 'cache-control': 'private, no-store' } },
    '/invoice/**': { headers: { 'cache-control': 'private, no-store' } },
    '/update-profile': { headers: { 'cache-control': 'private, no-store' } },
    '/request-book': { headers: { 'cache-control': 'private, no-store' } },
    '/user-book': { headers: { 'cache-control': 'private, no-store' } },
    '/affiliate/**': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/admin/**': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/api/**': { headers: { 'cache-control': 'private, no-store' } },
  },

  nitro: {
    // sanitize-html is CommonJS and require()s the ES-only htmlparser2. Node can do that, but Vercel's function runtime refuses it (ERR_REQUIRE_ESM, every route that
    // imports server/utils/sanitize.ts answered 500). Bundling it turns that require into a plain import.
    externals: { inline: ['sanitize-html'] },
    // security headers for every response
    routeRules: {
      '/**': {
        headers: {
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-frame-options': 'SAMEORIGIN',
        },
      },
    },
  },
})
