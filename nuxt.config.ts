// AAWRAQ platform — Nuxt 4 application (storefront + account + affiliate + admin in one deployment).
const isProd = process.env.NODE_ENV === 'production'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/supabase', '@pinia/nuxt'],
  typescript: { strict: true, typeCheck: false },

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
    paymentProvider: 'dev_simulator', // dev_simulator | paymob | tap  (real gateways are NOT wired — docs/10-remaining-blockers)
    allowDevPaymentSimulator: process.env.NODE_ENV !== 'production',
    signedUrlTtlSeconds: 120,
    // Which media backends may serve/accept files in THIS environment (override: NUXT_MEDIA_ENABLED_PROVIDERS).
    // Local dev: Supabase Storage + external links. Hosted/production default: external links only until the VPS adapter exists.
    mediaEnabledProviders: process.env.NODE_ENV === 'production' ? 'external' : 'supabase,external',
    public: {
      siteUrl: 'http://127.0.0.1:3000',
    },
  },

  routeRules: {
    // public SEO pages: SSR with a short shared cache. Personalised content is never rendered server-side into these.
    '/': { swr: 60 },
    '/book/**': { swr: 60 },
    '/post/**': { swr: 120 },
    '/p/**': { swr: 300 },
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
