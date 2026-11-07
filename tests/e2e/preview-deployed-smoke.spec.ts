// Smoke test of a DEPLOYED protected preview, driven by a real browser: navigation, RTL and responsiveness, search and categories with an empty catalogue,
// admin protection, the Supabase project the browser talks to, and secrets in the public bundle.
//   PREVIEW_ORIGIN=https://<origin> PREVIEW_USER=<user> PREVIEW_PASSWORD=<password> npx playwright test -c tests/e2e/playwright.config.ts preview-deployed-smoke
// The password comes from the environment only and is never printed. Skipped when the variables are not set. It buys nothing and writes nothing; the only
// authentication attempt uses an address that cannot exist and is expected to be refused.
import { test, expect, type Page } from '@playwright/test'

const ORIGIN = (process.env.PREVIEW_ORIGIN ?? '').replace(/\/+$/, '')
const USER = process.env.PREVIEW_USER ?? ''
const PASSWORD = process.env.PREVIEW_PASSWORD ?? ''
const SUPABASE_REF = process.env.PREVIEW_SUPABASE_REF ?? 'ubjuyeccioflhpcpnhmo'
test.skip(!ORIGIN || !USER || !PASSWORD, 'set PREVIEW_ORIGIN, PREVIEW_USER and PREVIEW_PASSWORD to run the deployed-preview smoke test')

const VIEWPORTS = [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }] as const
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

function watch(page: Page) {
  const problems: string[] = []
  const supabaseHosts = new Set<string>()
  const local: string[] = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 140)}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 140)}`) })
  page.on('response', (r) => { if (r.status() >= 400 && r.status() !== 401) problems.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`) })
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (/supabase\.(co|in)$/.test(u.hostname)) supabaseHosts.add(u.hostname)
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(u.hostname) && !ORIGIN.includes(u.hostname)) local.push(r.url())
  })
  return { problems, supabaseHosts, local }
}

for (const vp of VIEWPORTS) {
  test.describe(`deployed preview, viewport ${vp.n}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h }, httpCredentials: { username: USER, password: PASSWORD } })

    test('every navigation link opens an Arabic RTL page without errors or sideways scroll', async ({ page }) => {
      const w = watch(page)
      await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' })
      const hrefs = await page.locator('header a[href^="/"], nav a[href^="/"], footer a[href^="/"]').evaluateAll((as) => [...new Set((as as HTMLAnchorElement[]).map((a) => a.getAttribute('href') ?? ''))])
      const paths = hrefs.filter((h) => h && !h.startsWith('//') && !/^\/(admin|api|_nuxt)/.test(h)).slice(0, 30)
      expect(paths.length, 'the header or footer offers navigation').toBeGreaterThan(3)
      for (const p of paths) {
        const res = await page.goto(`${ORIGIN}${p}`, { waitUntil: 'networkidle' })
        expect(res?.status(), p).toBeLessThan(400)
        await expect(page.locator('html'), p).toHaveAttribute('dir', 'rtl')
        expect(await overflow(page), `sideways scroll on ${p}`).toBeLessThanOrEqual(1)
        expect(await page.locator('body').innerText(), p).not.toMatch(/\b(undefined|NaN|\[object Object\])\b/)
      }
      expect(w.problems).toEqual([])
      expect(w.local, 'the page never talks to a local server').toEqual([])
    })

    test('categories and search answer honestly while the catalogue is empty', async ({ page }) => {
      const w = watch(page)
      for (const p of ['/categories', '/search?search=%D9%83%D8%AA%D8%A7%D8%A8', '/search?search=zzzz-no-such-book', '/authors', '/articles']) {
        const res = await page.goto(`${ORIGIN}${p}`, { waitUntil: 'networkidle' })
        expect(res?.status(), p).toBe(200)
        expect(await overflow(page), `sideways scroll on ${p}`).toBeLessThanOrEqual(1)
        await expect(page.locator('main, #app, body').first()).toBeVisible()
      }
      // nothing invented: no book card links to a synthetic record
      await page.goto(`${ORIGIN}/search?search=zzzz-no-such-book`, { waitUntil: 'networkidle' })
      expect(await page.locator('a[href^="/book/"]').count(), 'a search with no match lists no book').toBe(0)
      expect(await page.locator('body').innerText()).not.toMatch(/كتاب تجريبي|قسم محاكاة|مؤلف محاكاة|\[journey-test\]|\[sweep-test\]|\[recovery-|__hosted_test__/)
      expect(w.problems).toEqual([])
    })

    test('the admin area leads a guest to the login, and a refused sign-in reaches the authorised Supabase project only', async ({ page }) => {
      const w = watch(page)
      await page.goto(`${ORIGIN}/admin/books`, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/(admin\/)?login/, { timeout: 30_000 })
      await expect(page.getByRole('button', { name: /الدخول/ })).toBeVisible()
      await page.getByLabel('البريد الإلكترونى').fill('nobody@example.invalid')
      await page.getByLabel('كلمة المرور').fill('not-a-real-password-123')
      await page.getByRole('button', { name: /الدخول/ }).click()
      await expect(page.getByText('البريد الإلكتروني أو كلمة المرور غير صحيحة')).toBeVisible({ timeout: 30_000 })
      expect([...w.supabaseHosts], 'the browser talks to exactly the authorised project').toEqual([`${SUPABASE_REF}.supabase.co`])
      expect(w.local).toEqual([])
      expect(w.problems.filter((p) => !/\b400\b|Failed to load resource/.test(p))).toEqual([]) // the refused sign-in itself is a 400 from Supabase Auth
    })
  })
}

test('the public bundle carries no secret: no secret key, no password hash, no service role', async ({ request }) => {
  const auth = { authorization: `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}` }
  const html = await (await request.get(`${ORIGIN}/`, { headers: auth })).text()
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_nuxt\/[^"?#]+\.(?:js|css))"/g)].map((m) => m[1]!))]
  expect(assets.length).toBeGreaterThan(0)
  const bodies = [html]
  for (const a of assets.slice(0, 60)) bodies.push(await (await request.get(`${ORIGIN}${a}`)).text()) // static files are served without the gate: that is what an outsider can read
  const all = bodies.join('\n')
  expect(all).not.toMatch(/sb_secret_/)
  expect(all).not.toMatch(/scrypt\$\d+\$/)
  expect(all).not.toMatch(/service_role/)
  expect(all).not.toMatch(/NUXT_SUPABASE_SECRET_KEY|NUXT_PREVIEW_PASSWORD_HASH/)
  expect(all).toContain(`${SUPABASE_REF}.supabase.co`) // the build points at the authorised project
  expect(all).not.toMatch(/127\.0\.0\.1:543\d\d|localhost:543\d\d/) // and never at a local stack
})
