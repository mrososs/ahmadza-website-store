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
  page.on('response', (r) => { if (r.status() >= 400 && r.status() !== 401) problems.push(`HTTP ${r.status()} ${r.url().slice(0, 110)} (on ${page.url().slice(0, 80)})`) })
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

    test('the recovered catalogue under review is visible, labelled as unreviewed, and offers nothing to buy or download', async ({ page }) => {
      const w = watch(page)
      const summary = await (await page.request.get(`${ORIGIN}/api/preview/recovered/summary`)).json()
      expect(summary.enabled, 'the preview exposes the recovered catalogue').toBe(true)
      expect(summary.total, 'recovered books exist in the hosted project').toBeGreaterThan(0)

      // home: a clearly separated strip, a bounded number of cards, a link to the full list
      await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' })
      await expect(page.locator('.recovered-home')).toBeVisible()
      await expect(page.locator('.recovered-home')).toContainText('قيد المراجعة')
      expect(await page.locator('.recovered-home .recovered-card').count()).toBeLessThanOrEqual(8)
      expect(await page.locator('.recovered-home .recovered-card').count()).toBeGreaterThan(0)

      // the full page
      await page.goto(`${ORIGIN}/recovered`, { waitUntil: 'networkidle' })
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
      await expect(page.getByRole('heading', { name: /الكتالوج المستعاد/ })).toBeVisible()
      await expect(page.locator('.recovered-card').first()).toBeVisible()
      expect(await page.locator('.recovered-card').count()).toBe(Math.min(24, summary.total))
      await expect(page.getByText(`${summary.total} كتابًا قيد المراجعة`)).toBeVisible()
      const cards = page.locator('.recovered-card')
      for (let i = 0; i < Math.min(await cards.count(), 6); i++) {
        await expect(cards.nth(i)).toContainText('قيد المراجعة')
        await expect(cards.nth(i).locator('.recovered-badge'), 'the review badge text is white (it was unreadable dark brown)').toHaveCSS('color', 'rgb(255, 255, 255)')
        await expect(cards.nth(i)).toContainText('السعر غير محدد')
        await expect(cards.nth(i)).toContainText('المؤلف غير محدد')
        // a stored cover (content-hashed key in the public bucket) or the default one; either way the image really loads: never a broken image
        const img = cards.nth(i).locator('img')
        await img.scrollIntoViewIfNeeded()
        await expect(img).toHaveAttribute('src', /default-cover|\/public-media\/books\/\d+\/[0-9a-f]{12}\.jpg$/)
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: 'the cover image loads' }).toBe(true)
      }
      // most books now show a real cover, and every cover says where it came from
      const real = await page.locator('.recovered-card img[src*="/public-media/books/"]').count()
      expect(real, 'most cards on the first page show a stored cover').toBeGreaterThanOrEqual(Math.floor(Math.min(24, summary.total) * 0.6))
      await page.locator('.recovered-card summary').first().click()
      await expect(page.locator('.recovered-card [data-testid="cover-label"]').first()).toContainText(/مُولَّدة|الغلاف الأصلي|لا يوجد غلاف/)
      // nothing to buy, nothing to download, no link into a product page
      expect(await page.locator('.recovered-card a, .recovered-card button').count()).toBe(0)
      expect(await page.locator('a[href^="/book/"], a[href*="/api/library/download"], a[href^="/checkout"]').count()).toBe(0)
      // (the page's own sentence says the books cannot be bought or downloaded, so the check is on the actions it offers, not on its prose)
      const actions = (await page.locator('.recovered-page a, .recovered-page button').allInnerTexts()).join(' | ')
      expect(actions).not.toMatch(/السلة|اشتر|شراء|تحميل|تنزيل|دفع/)
      expect(await overflow(page)).toBeLessThanOrEqual(1)

      // the details disclose the evidence, not private paths
      await page.locator('.recovered-card summary').first().click()
      const detail = await page.locator('.recovered-card details').first().innerText()
      expect(detail).toMatch(/بصمة الملف/)
      expect(detail).toMatch(/الملف الأصلي/)
      expect(detail).not.toMatch(/storage|books\/recovered|product_media|sb_|supabase\.co/)

      // search works and an empty result is honest
      const first = await page.locator('.recovered-card h3.name').first().innerText()
      await page.goto(`${ORIGIN}/recovered?search=${encodeURIComponent(first.split(/\s+/)[0]!)}`, { waitUntil: 'networkidle' })
      expect(await page.locator('.recovered-card').count()).toBeGreaterThan(0)
      await page.goto(`${ORIGIN}/recovered?search=zzzz-no-such-recovered-book`, { waitUntil: 'networkidle' })
      await expect(page.getByText('لا توجد كتب مستعادة مطابقة لبحثك.')).toBeVisible()
      expect(await page.locator('.recovered-card').count()).toBe(0)

      // paging
      if (summary.total > 24) {
        await page.goto(`${ORIGIN}/recovered?page=2`, { waitUntil: 'networkidle' })
        expect(await page.locator('.recovered-card').count()).toBe(Math.min(24, summary.total - 24))
      }
      expect(w.problems).toEqual([])
    })
  })
}

test('the recovered-catalogue API is behind the password and returns only whitelisted fields', async ({ request }) => {
  for (const p of ['/api/preview/recovered', '/api/preview/recovered/summary', '/recovered']) expect((await request.get(`${ORIGIN}${p}`)).status(), `anonymous ${p}`).toBe(401)
  const auth = { authorization: `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}` }
  const res = await request.get(`${ORIGIN}/api/preview/recovered?limit=24`, { headers: auth })
  expect(res.status()).toBe(200)
  expect(res.headers()['cache-control']).toMatch(/no-store/)
  const body = await res.json()
  expect(body.items.length).toBeGreaterThan(0)
  for (const it of body.items) expect(Object.keys(it).sort()).toEqual(['cover_path', 'cover_provenance', 'fingerprint', 'id', 'original_name', 'pages', 'scan', 'size_bytes', 'title'])
  const json = JSON.stringify(body)
  for (const forbidden of ['storage_path', 'books/recovered', 'price', 'author', 'cover-candidates', 'private-sensitive', 'candidates', 'legacy_path', 'recovery_evidence', 'sb_secret']) expect(json, forbidden).not.toContain(forbidden)
  expect((await request.get(`${ORIGIN}/api/preview/recovered?search=%25_%5C`, { headers: auth })).status(), 'wildcard characters in a search are harmless').toBe(200)
})

test('the public bundle carries no secret: no secret key, no password hash, no service role', async ({ request }) => {
  const auth = { authorization: `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}` }
  const html = await (await request.get(`${ORIGIN}/`, { headers: auth })).text()
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_nuxt\/[^"?#]+\.(?:js|css))"/g)].map((m) => m[1]!))]
  expect(assets.length).toBeGreaterThan(0)
  const bodies = [html]
  for (const a of assets.slice(0, 60)) bodies.push(await (await request.get(`${ORIGIN}${a}`)).text()) // static files are served without the gate: that is what an outsider can read
  const all = bodies.join('\n')
  // the Supabase client library contains the bare prefix "sb_secret_" (it uses it to REFUSE secret keys in a browser), so look for a real key: prefix plus key body
  expect(all).not.toMatch(/sb_secret_[A-Za-z0-9_-]{20,}/)
  expect(all).not.toMatch(/scrypt\$\d+\$/)
  for (const m of all.matchAll(/eyJ[\w-]{10,}\.([\w-]{10,})\.[\w-]{10,}/g)) expect(Buffer.from(m[1]!, 'base64url').toString(), 'a JWT in the bundle must not be a service-role token').not.toMatch(/"role"\s*:\s*"service_role"/)
  expect(all).not.toMatch(/NUXT_SUPABASE_SECRET_KEY|NUXT_PREVIEW_PASSWORD_HASH/)
  expect(all).toContain(`${SUPABASE_REF}.supabase.co`) // the build points at the authorised project
  expect(all).not.toMatch(/127\.0\.0\.1:543\d\d|localhost:543\d\d/) // and never at a local stack
})
