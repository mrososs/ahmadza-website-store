// Acceptance test of a DEPLOYED protected preview, driven by a real browser. Point it at any origin (a local production build, or the real deployment):
//   PREVIEW_ORIGIN=https://<origin> PREVIEW_USER=<user> PREVIEW_PASSWORD=<password> npx playwright test -c tests/e2e/playwright.config.ts preview-production
// The password comes from the environment only and is never printed. Skipped when PREVIEW_ORIGIN is not set. It performs no purchase and writes nothing.
import { test, expect } from '@playwright/test'

const ORIGIN = (process.env.PREVIEW_ORIGIN ?? '').replace(/\/+$/, '')
const USER = process.env.PREVIEW_USER ?? ''
const PASSWORD = process.env.PREVIEW_PASSWORD ?? ''
test.skip(!ORIGIN || !USER || !PASSWORD, 'set PREVIEW_ORIGIN, PREVIEW_USER and PREVIEW_PASSWORD to run the deployed-preview acceptance test')

const VIEWPORTS = [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }] as const

test.describe('anonymous visitors (a real browser with no credentials)', () => {
  test('every page and API answers 401 with no application content, no indexing and no caching', async ({ page, request }) => {
    for (const path of ['/', '/book/1', '/search?search=x', '/cart', '/admin', '/admin/login', '/api/admin/books', '/api/checkout/methods', '/sitemap.xml']) {
      const res = await request.get(`${ORIGIN}${path}`, { maxRedirects: 0 })
      expect(res.status(), path).toBe(401)
      expect(res.headers()['www-authenticate'], path).toMatch(/^Basic /)
      expect(res.headers()['x-robots-tag'], path).toMatch(/noindex/)
      expect(res.headers()['cache-control'], path).toMatch(/no-store/)
      const body = await res.text()
      expect(body, path).toBe('Authentication required')
    }
    // a browser that is not given credentials is CHALLENGED: Chromium reports an unanswered Basic challenge as ERR_INVALID_AUTH_CREDENTIALS, a 401 is the same refusal
    let status: number | null = null
    let blocked = ''
    try { status = (await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }))?.status() ?? null } catch (e) { blocked = String(e) }
    expect(status === 401 || /ERR_INVALID_AUTH_CREDENTIALS/.test(blocked), `status ${status} ${blocked.slice(0, 80)}`).toBe(true)
    if (status) expect(await page.content()).not.toMatch(/<link[^>]+stylesheet|_nuxt|أوراق عربية/) // not a single byte of the application
  })

  test('robots.txt is open and disallows everything', async ({ request }) => {
    const res = await request.get(`${ORIGIN}/robots.txt`)
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('Disallow: /')
  })

  test('a wrong password and a wrong user name are refused by the browser flow too', async ({ browser }) => {
    for (const creds of [{ username: USER, password: `${PASSWORD}-wrong` }, { username: `${USER}-wrong`, password: PASSWORD }]) {
      const ctx = await browser.newContext({ httpCredentials: creds })
      const res = await ctx.request.get(`${ORIGIN}/`)
      expect(res.status()).toBe(401)
      await ctx.close()
    }
  })
})

for (const vp of VIEWPORTS) {
  test.describe(`with the preview password, viewport ${vp.n}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h }, httpCredentials: { username: USER, password: PASSWORD } })

    test('the storefront renders; responses are noindex and not cacheable; canonical URLs exist; no hydration errors; no demo content', async ({ page }) => {
      const problems: string[] = []
      page.on('console', (m) => { if (/hydrat/i.test(m.text())) problems.push(m.text().slice(0, 160)) })
      page.on('pageerror', (e) => problems.push(e.message.slice(0, 160)))
      const res = await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' })
      expect(res?.status()).toBe(200)
      expect(res?.headers()['x-robots-tag']).toMatch(/noindex/)
      expect(res?.headers()['cache-control']).toMatch(/no-store/)
      expect(res?.headers()['cache-control']).not.toMatch(/s-maxage/)
      // nothing is promised that cannot be honoured: with no usable payment method the footer shows no card or mada logos
      await expect(page.locator('img[alt="وسائل الدفع"]')).toHaveCount(0)
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toMatch(/^https:\/\/[^/]+\/$/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      const text = await page.locator('body').innerText()
      // "إطلاق تجريبي" (beta launch) is a badge of the ORIGINAL site design, not data. What must never appear is synthetic catalogue data or test fixtures.
      expect(text, 'no synthetic catalogue is presented as real content').not.toMatch(/كتاب تجريبي|قسم محاكاة|مؤلف محاكاة|\[journey-test\]|\[recovery-|\[queue-test\]|\[sweep-test\]|__hosted_test__/)
      expect(problems).toEqual([])
      await page.screenshot({ path: `test-results/preview-production/home-${vp.n}.png`, fullPage: true })
    })

    test('a missing book is an Arabic 404 that is also not cacheable; /admin leads a guest to the login; the cart works', async ({ page }) => {
      const missing = await page.goto(`${ORIGIN}/book/99999999`, { waitUntil: 'domcontentloaded' })
      expect(missing?.status()).toBe(404)
      expect(missing?.headers()['cache-control']).toMatch(/no-store/)
      await page.goto(`${ORIGIN}/admin`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(/\/(login|admin\/login)/, { timeout: 20_000 })
      await page.goto(`${ORIGIN}/cart`, { waitUntil: 'networkidle' })
      await expect(page.locator('body')).toContainText(/السلة/)
    })

    test('checkout, payment webhooks and downloads are switched off even for someone who knows the preview password', async ({ page }) => {
      for (const [method, path] of [['POST', '/api/checkout/session'], ['POST', '/api/webhooks/payments/paymob'], ['POST', '/api/webhooks/payments/tap'], ['GET', '/api/library/download/1']] as const) {
        const res = await page.request.fetch(`${ORIGIN}${path}`, { method, data: method === 'POST' ? {} : undefined })
        expect(res.status(), `${method} ${path}`).toBe(503)
      }
      // the list of payment methods answers honestly (nothing to offer) instead of failing on every page
      const methods = await page.request.get(`${ORIGIN}/api/checkout/methods`)
      expect(methods.status()).toBe(200)
      expect((await methods.json()).methods).toEqual([])
      const admin = await page.request.get(`${ORIGIN}/api/admin/books`)
      expect(admin.status()).toBe(401) // the preview password is not an administrator session
    })
  })
}
