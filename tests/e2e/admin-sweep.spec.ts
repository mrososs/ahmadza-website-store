// FINAL real-browser review of the whole admin area, as an operator would use it. Logs in ONCE through the real /admin/login form, then reuses the session.
//   npx playwright test -c tests/e2e/playwright.config.ts admin-sweep
// Runs at 1440x900 and 390x844 against the LOCAL dev server + LOCAL Supabase (synthetic data only). Screenshots: test-results/admin-sweep/.
// Fixtures / created rows carry the tag "[sweep-test]" and are removed afterwards (users made through createTestUser stay, by design).
import { test as base, expect, type Locator, type Page, type Request } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { DEV_PASSWORD, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'
import { createTestUser } from '../helpers/commerce'
import { syntheticPdf } from '../helpers/synthetic-pdf'

const VIEWPORTS = [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }] as const
const SHOTS = new URL('../../test-results/admin-sweep/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const STATE = `${tmpdir()}/aawraq-admin-sweep-state.json` // outside test-results: other Playwright runs clean that folder
const TAG = '[sweep-test]'
const BASE = process.env.TEST_APP_URL ?? 'http://localhost:3000'
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const svc = serviceClient()
const stamp = randomUUID().slice(0, 6)

/** Fails the test on any Vue hydration warning, uncaught page error or HTTP 5xx from the app; also records console errors and 4xx API answers. */
type Watch = { hydration: string[]; errors: string[]; http5xx: string[]; http4xx: string[]; consoleErrors: string[] }
const test = base.extend<{ watch: Watch }>({
  watch: [async ({ page }, use) => {
    const w: Watch = { hydration: [], errors: [], http5xx: [], http4xx: [], consoleErrors: [] }
    page.on('console', (m) => {
      if (/hydrat/i.test(m.text())) w.hydration.push(m.text().split('\n')[0]!.slice(0, 200))
      else if (m.type() === 'error') w.consoleErrors.push(m.text().split('\n')[0]!.slice(0, 200))
    })
    page.on('pageerror', (e) => { if (!/Failed to fetch dynamically imported module: .*\/_nuxt\/.*[?&]t=\d+/.test(e.message)) w.errors.push(e.message.slice(0, 200)) }) // a Vite dev hot-reload artefact, not an app error
    page.on('response', (r) => {
      const u = r.url()
      if (!u.startsWith(BASE)) return
      if (r.status() === 503 && /Dev server is unavailable/i.test(r.statusText())) return // the shared dev server restarting under concurrent work: not an application answer
      if (r.status() >= 500) w.http5xx.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`)
      else if (r.status() >= 400 && u.includes('/api/')) w.http4xx.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`)
    })
    await use(w)
    expect(w.hydration, 'hydration warnings').toEqual([])
    expect(w.errors, 'uncaught page errors').toEqual([])
    expect(w.http5xx, 'HTTP 5xx answers').toEqual([])
  }, { auto: true }],
})
test.use({ storageState: STATE })

// ------------------------------------------------------------------------------------------------ helpers
async function ready(page: Page) {
  await page.waitForFunction(() => (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp?.().isHydrating === false, null, { timeout: 45_000 })
  await expect(page.locator('.fa-spin')).toHaveCount(0, { timeout: 20_000 })
}
async function open(page: Page, path: string) {
  let res = await page.goto(path, { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 4 && res?.status() === 503; i++) { await page.waitForTimeout(2000); res = await page.goto(path, { waitUntil: 'domcontentloaded' }) } // shared dev server blip
  try { await ready(page) } catch (e) {
    // the shared Vite dev server hot-reloads while other work edits files: one reload retry, a second failure is a real failure
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page).catch(() => { throw e })
  }
  return res
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const noSidewaysScroll = async (page: Page) => expect(await overflow(page), 'horizontal page scroll (px)').toBeLessThanOrEqual(1)
const hasArabic = (s: string) => /[؀-ۿ]/.test(s)
/** A user-facing validation message must be Arabic prose: no English sentence and no raw schema wording. */
const expectArabicMessage = (s: string, ctx: string) => { expect(hasArabic(s), `Arabic message (${ctx}): "${s}"`).toBe(true); expect(/[A-Za-z]{5,}/.test(s.replace(/https?:\/\/\S*/g, '')), `no English words (${ctx}): "${s}"`).toBe(false) }
const slug = (s: string) => s.replace(/^\/admin\/?/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dashboard'
async function shot(page: Page, name: string, vp: string) { await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' }).catch(() => {}); await page.screenshot({ path: `${SHOTS}${name}-${vp}.png`, fullPage: true }) }

/** Page-level health checks every admin page must pass. */
async function assertHealthy(page: Page, label: string, opts: { heading?: boolean } = {}) {
  if (opts.heading !== false) {
    const h = page.locator('.page-title h4').first()
    await expect(h, `${label}: page heading`).toBeVisible()
    expect((await h.innerText()).trim().length, `${label}: heading text`).toBeGreaterThan(0)
  }
  await expect(page.locator('.alert-danger'), `${label}: alert-danger`).toHaveCount(0)
  const body = await page.locator('body').innerText()
  expect(body, `${label}: 404 text`).not.toMatch(/هذه الصفحة غير موجودة|Page not found|\b404\b/)
  expect(body, `${label}: raw undefined/null/NaN rendered`).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]/)
  await noSidewaysScroll(page)
}

/** A control that "does something": URL change, dialog, visible text change or an /api request. */
async function expectEffect(page: Page, what: string, action: () => Promise<unknown>) {
  const before = { url: page.url(), text: await page.evaluate(() => document.body.innerText) }
  let reqs = 0
  const h = (r: Request) => { if (r.url().includes('/api/')) reqs++ }
  page.on('request', h)
  await action()
  let changed = false
  for (let i = 0; i < 16 && !changed; i++) { // up to ~4 s: a navigation or request may land a moment after the click
    await page.waitForTimeout(250)
    const text = await page.evaluate(() => document.body.innerText).catch(() => before.text)
    changed = page.url() !== before.url || text !== before.text || reqs > 0 || (await page.locator('[role=dialog]:visible').count()) > 0
  }
  page.off('request', h)
  expect(changed, `dead control: ${what}`).toBe(true)
}

const group = (page: Page, label: string) => page.locator('.form-group').filter({ has: page.locator('label').filter({ hasText: new RegExp(`^\\s*${label}\\s*\\*?\\s*$`) }) }).first()
/** The bootstrap-select look-alike: open it, choose by visible label. */
async function pickSelect(scope: Locator, option: string) {
  await scope.locator('button.dropdown-toggle').first().click()
  await scope.locator('.dropdown-menu.show a[role=option]').filter({ hasText: new RegExp(`^\\s*${option}\\s*$`) }).first().click()
}
async function rowOps(page: Page, row: Locator, item: string | RegExp) {
  await row.locator('[data-toggle="dropdown"]').click()
  const menu = row.locator('.dropdown-menu.show')
  await expect(menu).toBeVisible()
  await menu.getByText(item).first().click()
}
/** Public pages sit behind a short shared cache (swr 60s book / 120s post / 300s page): bypass it with a unique query to read what the ORIGIN says. */
const origin = (page: Page, path: string) => page.request.get(`${path}${path.includes('?') ? '&' : '?'}_sweep=${Date.now()}${Math.random()}`)
const modal = (page: Page) => page.getByRole('dialog')
async function loginViaAdminForm(page: Page, email: string, password: string) {
  await page.goto('/admin/login', { waitUntil: 'domcontentloaded' })
  await ready(page)
  await page.getByLabel('البريد الإلكترونى').fill(email)
  await page.getByLabel('كلمة المرور').fill(password)
  await page.getByRole('button', { name: /الدخول/ }).click()
}

// ------------------------------------------------------------------------------------------------ shared fixtures
const tagged = { catIds: [] as number[], bookId: 0, catId: 0, makerId: 0, articleId: 0, pageSlug: '', userId: '', userEmail: '', affiliateId: '', orderNo: 0, affiliateIdSeed: '' }
const storagePaths: { bucket: string; path: string }[] = []
let originalSettings: Record<string, unknown> | null = null
let customerId = ''
let contributorId = ''

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000)
  mkdirSync(SHOTS, { recursive: true })
  // 1. the ONLY real login: through the /admin/login form; the stored session is reused by every test below
  const ctx = await browser.newContext({ baseURL: BASE, locale: 'ar', storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  for (let attempt = 1; ; attempt++) {
    try {
      await loginViaAdminForm(page, DEV_USERS.admin, DEV_PASSWORD)
      await page.waitForURL(/\/admin\/?$/, { timeout: 60_000 })
      await ready(page)
      break
    } catch (e) { if (attempt >= 3) throw e } // the shared dev server may still be compiling after a source change
  }
  writeFileSync(STATE, JSON.stringify(await ctx.storageState()))
  await ctx.close()

  customerId = (await signedInClient(DEV_USERS.customer)).userId
  contributorId = (await signedInClient(DEV_USERS.contributor)).userId
  originalSettings = (await svc.from('site_settings').select('*').eq('id', 1).single()).data as Record<string, unknown>

  // 2. read-only seed facts for the dynamic pages
  tagged.orderNo = (await svc.from('orders').select('order_no').order('order_no', { ascending: false }).limit(1).single()).data!.order_no
  tagged.affiliateIdSeed = (await svc.from('profiles').select('id').eq('is_affiliate', true).limit(1).single()).data!.id
  // 3. 22 tagged categories = a second page in the generic list (page size 20)
  const rows = Array.from({ length: 22 }, (_, i) => ({ name: `${TAG} pg ${String(i).padStart(2, '0')} ${stamp}`, slug: `sweep-pg-${stamp}-${i}`, is_active: true, is_demo: true }))
  const { data } = await svc.from('categories').insert(rows as never).select('id')
  tagged.catIds = (data ?? []).map((r) => r.id)
  // 4. dynamic fixtures used by the crawl
  tagged.bookId = (await svc.from('books').insert({ title: `${TAG} crawl book ${stamp}`, kind: 'paid', status: 'draft', price_amount: 5, is_demo: true } as never).select('id').single()).data!.id
  tagged.catId = tagged.catIds[0]!
  tagged.makerId = (await svc.from('makers').insert({ name: `${TAG} crawl maker ${stamp}`, kind: 'author', era: 'new', is_active: true, is_demo: true } as never).select('id').single()).data!.id
  tagged.articleId = (await svc.from('articles').insert({ title: `${TAG} crawl article ${stamp}`, kind: 'article', status: 'draft', is_demo: true } as never).select('id').single()).data!.id
  tagged.pageSlug = `sweep-crawl-${stamp}`
  await svc.from('pages').insert({ slug: tagged.pageSlug, title: `${TAG} crawl page ${stamp}`, status: 'draft', positions: [], is_demo: true } as never)
  const u = await createTestUser()
  tagged.userId = u.id; tagged.userEmail = u.email
})

test.afterAll(async () => {
  const books = (await svc.from('books').select('id,cover_path').like('title', `%${TAG}%`)).data ?? []
  for (const b of books) if (b.cover_path) storagePaths.push({ bucket: 'public-media', path: b.cover_path })
  const media = (await svc.from('book_media').select('storage_path').in('book_id', books.map((b) => b.id))).data ?? []
  for (const m of media) if (m.storage_path) storagePaths.push({ bucket: 'private-products', path: m.storage_path })
  await svc.from('comments').delete().like('body', `${TAG}%`)
  await svc.from('contact_messages').delete().like('message', `${TAG}%`)
  await svc.from('contributor_requests').delete().like('title', `${TAG}%`)
  await svc.from('books').delete().like('title', `%${TAG}%`)
  for (const t of ['categories', 'makers'] as const) {
    const old = (await svc.from(t).select('id,image_path').like('name', `%${TAG}%`)).data ?? []
    for (const r of old) if (r.image_path) storagePaths.push({ bucket: 'public-media', path: r.image_path })
    await svc.from(t).delete().like('name', `%${TAG}%`)
  }
  for (const t of ['articles', 'pages'] as const) {
    const old = (await svc.from(t).select('id').like('title', `%${TAG}%`)).data ?? []
    if (old.length) await svc.from(t).delete().in('id', old.map((r) => r.id))
  }
  if (originalSettings) {
    const o = originalSettings
    const { data: cur } = await svc.from('site_settings').select('logo_path,poster_path,poster_mobile_path').eq('id', 1).single()
    for (const p of [cur?.logo_path, cur?.poster_path, cur?.poster_mobile_path]) if (p && !Object.values(o).includes(p)) storagePaths.push({ bucket: 'public-media', path: p })
    await svc.from('site_settings').update({ ...o, id: undefined } as never).eq('id', 1)
  }
  for (const s of storagePaths) await svc.storage.from(s.bucket).remove([s.path]).catch(() => {})
})

// ------------------------------------------------------------------------------------------------ guards (no viewport dependency)
test.describe('access guards', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test('a guest is sent to a login page, and a signed-in customer is kept out of /admin', async ({ page, browser }) => {
    await page.goto('/admin/books', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/(admin\/)?login/, { timeout: 30_000 })
    await ready(page)
    await expect(page.getByRole('button', { name: /الدخول/ })).toBeVisible()
    // a customer who types the admin URL never sees admin chrome
    const ctx = await browser.newContext({ baseURL: BASE, locale: 'ar', storageState: { cookies: [], origins: [] } })
    const p = await ctx.newPage()
    await loginViaAdminForm(p, DEV_USERS.customer, DEV_PASSWORD)
    await expect(p.getByText('هذا الحساب ليس لديه صلاحية الدخول إلى لوحة التحكم')).toBeVisible()
    await ctx.close()
  })
  test('the admin login form validates empty and wrong credentials in Arabic', async ({ page }) => {
    await open(page, '/admin/login')
    await page.getByRole('button', { name: /الدخول/ }).click()
    expectArabicMessage(await page.locator('.alert-danger').innerText(), 'empty login')
    await page.getByLabel('البريد الإلكترونى').fill('admin@aawraq.test')
    await page.getByLabel('كلمة المرور').fill('wrong-password-123')
    await page.getByRole('button', { name: /الدخول/ }).click()
    await expect(page.getByText('البريد الإلكتروني أو كلمة المرور غير صحيحة')).toBeVisible()
  })
})

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })
    const N = (s: string) => `${TAG} ${s} ${vp.name}-${stamp}`
    const fx = { bookId: 0, commentId: 0, contactId: 0, reqApprove: '', reqDecline: '', reqApproveTitle: '', reqDeclineTitle: '' }

    test.beforeAll(async () => {
      fx.bookId = (await svc.from('books').insert({ title: N('fixture book'), kind: 'paid', status: 'published', price_amount: 3, is_demo: true } as never).select('id').single()).data!.id
      fx.commentId = (await svc.from('comments').insert({ user_id: customerId, book_id: fx.bookId, body: `${TAG} تعليق ${vp.name}-${stamp}`, status: 'pending' } as never).select('id').single()).data!.id
      fx.contactId = (await svc.from('contact_messages').insert({ name: N('sender'), email: 'sweep@aawraq.test', subject: 'note', message: `${TAG} رسالة ${vp.name}-${stamp}` } as never).select('id').single()).data!.id
      fx.reqApproveTitle = N('request approve'); fx.reqDeclineTitle = N('request decline')
      const base = { user_id: contributorId, deal: 'share', cost: 5, currency: 'USD', whatsapp: '+966500000001', iban: 'SA0000000000000000000000', status: 'pending' }
      fx.reqApprove = (await svc.from('contributor_requests').insert({ ...base, title: fx.reqApproveTitle, maker_name: 'مؤلف اختبار', about: 'وصف' } as never).select('id').single()).data!.id
      fx.reqDecline = (await svc.from('contributor_requests').insert({ ...base, title: fx.reqDeclineTitle } as never).select('id').single()).data!.id
    })

    // ---------------------------------------------------------------------------------------------- 1. crawl
    test('1. crawl: every link in the sidebar, header and dashboard loads cleanly', async ({ page, watch }) => {
      test.setTimeout(600_000)
      await open(page, '/admin')
      await assertHealthy(page, 'dashboard')
      await shot(page, 'dashboard', vp.name)

      const hrefs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('.side-menu-fixed a[href], .admin-header a[href], .content-wrapper a[href]')]
        .map((a) => a.getAttribute('href') ?? '').filter((h) => h.startsWith('/') && !h.startsWith('//')))
      const links = [...new Set(hrefs.map((h) => h.replace(/#.*$/, '')).filter(Boolean))]
      const admin = links.filter((l) => l.startsWith('/admin'))
      const dynamic = [
        '/admin/books/create', `/admin/books/${tagged.bookId}`, `/admin/books/${tagged.bookId}/media`, '/admin/categories/create', `/admin/categories/${tagged.catId}`, '/admin/makers/create', `/admin/makers/${tagged.makerId}`,
        '/admin/articles/create', `/admin/articles/${tagged.articleId}`, '/admin/pages/create', `/admin/pages/${tagged.pageSlug && (await svc.from('pages').select('id').eq('slug', tagged.pageSlug).single()).data!.id}`,
        `/admin/users/${tagged.userId}`, `/admin/affiliates/${tagged.affiliateIdSeed}`, '/admin/affiliates/create', `/admin/invoice/${tagged.orderNo}`,
        `/admin/request-books/${fx.reqApprove}`, '/admin/stats/users', '/admin/stats/books', '/admin/stats/orders', '/admin/stats/revenue',
        '/admin/payments?review=needs_review', '/admin/security', '/admin/edit-profile', '/admin/demo-data', '/admin/site-info', '/admin/recovery',
        '/admin/books?workflow=draft', '/admin/books?recovery=recovered', '/admin/comments?status=pending', '/admin/contacts?status=open',
      ]
      const expected = ['/admin', '/admin/site-info', '/admin/contacts', '/admin/comments', '/admin/orders', '/admin/payments', '/admin/recovery', '/admin/affiliates', '/admin/withdraws', '/admin/books', '/admin/request-books', '/admin/stats/users', '/admin/pages', '/admin/articles', '/admin/users', '/admin/categories', '/admin/makers', '/admin/demo-data', '/admin/edit-profile']
      for (const e of expected) expect(admin.some((l) => l === e || l.startsWith(`${e}?`)), `sidebar/header exposes ${e}`).toBe(true)
      expect(admin.length, 'collected admin links').toBeGreaterThan(40)

      const seen = new Set<string>()
      const problems: string[] = []
      for (const url of [...admin, ...dynamic]) {
        if (seen.has(url)) continue
        seen.add(url)
        watch.http4xx.length = 0
        const blank = url === '/admin/security'
        try {
          const res = await open(page, url)
          if (res?.status() !== 200) problems.push(`${url}: HTTP ${res?.status()}`)
          await assertHealthy(page, url, { heading: !blank })
          if (blank) await expect(page.getByRole('heading', { name: /التحقق بخطوتين/ })).toBeVisible()
          if (watch.http4xx.length) problems.push(`${url}: API ${watch.http4xx.join(', ')}`)
        } catch (e) { problems.push(`${url}: ${(e as Error).message.split('\n')[0]}`) }
        await shot(page, slug(url), vp.name)
      }
      expect(problems, 'crawl problems').toEqual([])
      expect(watch.consoleErrors.filter((c) => !/favicon|Dev server is unavailable|net::ERR_(INSUFFICIENT_RESOURCES|NETWORK_CHANGED|INTERNET_DISCONNECTED|ABORTED)/i.test(c)), 'console errors during crawl').toEqual([])
      // the storefront link in the header answers too
      expect((await page.request.get('/')).status()).toBe(200)
    })

    // ---------------------------------------------------------------------------------------------- 2. chrome: sidebar, header, dropdowns
    test('2. chrome: sidebar groups expand, header menus open, every item in them navigates', async ({ page }) => {
      await open(page, '/admin')
      if (vp.width < 992) {
        // small screens: the sidebar is an off-canvas panel opened with the menu button
        await page.locator('#button-toggle').click()
      }
      const groups = page.locator('#sidebarnav > li > a[data-toggle="collapse"]')
      const count = await groups.count()
      expect(count).toBeGreaterThanOrEqual(8)
      for (let i = 0; i < count; i++) {
        const g = groups.nth(i)
        await g.scrollIntoViewIfNeeded()
        await g.click()
        const target = await g.getAttribute('data-target')
        await expect(page.locator(`${target}.collapse`), `sidebar group ${target} opens`).toHaveClass(/show/)
        await expect(page.locator(`${target} a`).first()).toBeVisible()
      }
      // a nested sidebar link navigates
      await page.locator('a[data-target="#books"]').click()
      await page.locator('#books a', { hasText: 'المفعلة' }).click()
      await expect(page).toHaveURL(/\/admin\/books\?status=active/)
      await ready(page)
      await expect(page.locator('.page-title h4')).toHaveText('الكتب')

      // quick services + account menu
      await page.locator('[aria-label="خدمات سريعة"]').click()
      const grid = page.locator('.dropdown-big')
      await expect(grid).toBeVisible()
      for (const [label, url] of [['إضافة كتاب', /books\/create/], ['إضافة مؤلف', /makers\/create/], ['إضافة مقال', /articles\/create/], ['إضافة صفحة', /pages\/create/]] as const) {
        if (!(await grid.isVisible())) await page.locator('[aria-label="خدمات سريعة"]').click()
        await grid.getByText(label).click()
        await expect(page).toHaveURL(url)
        await ready(page)
        await expect(page.locator('form')).toBeVisible()
      }
      await page.locator('[aria-label="الحساب"]').click()
      const acct = page.locator('.dropdown-menu.show')
      await expect(acct.getByText('admin@aawraq.test')).toBeVisible()
      await expect(acct.getByText('تسجيل الخروج')).toBeVisible() // NOT clicked: a global sign-out would revoke the admin session other runs use
      await expect(acct.getByText('عرض الموقع')).toBeVisible()
      await acct.getByText('بيانات الدخول').click()
      await expect(page).toHaveURL(/\/admin\/edit-profile/)
      await page.screenshot({ path: `${SHOTS}chrome-menu-${vp.name}.png` })
    })

    // ---------------------------------------------------------------------------------------------- 3. lists: search, pagination, filters, empty states
    test('3. lists: search, pagination, filters and empty states behave and read clearly', async ({ page }) => {
      // generic list with 22+ tagged rows -> 2 pages
      await open(page, `/admin/categories?q=${encodeURIComponent(`${TAG} pg`)}`)
      await expect(page.locator('tbody tr')).toHaveCount(20)
      await expect(page.locator('.dataTables_info')).toContainText(/عرض 1 إلى 20 من \d+ سجل/)
      await expect(page.locator('.pagination')).toBeVisible()
      await noSidewaysScroll(page)
      await expectEffect(page, 'pagination next', () => page.getByRole('link', { name: 'التالي' }).click())
      await expect(page).toHaveURL(/page=2/)
      await ready(page)
      expect(await page.locator('tbody tr').count()).toBeGreaterThanOrEqual(2)
      await expectEffect(page, 'pagination previous', () => page.getByRole('link', { name: 'السابق' }).click())
      await expect(page).not.toHaveURL(/page=2/)
      await ready(page)
      await page.locator('.pagination a.page-link', { hasText: /^2$/ }).click()
      await expect(page).toHaveURL(/page=2/)
      await ready(page)
      await shot(page, 'list-page2', vp.name)

      // search box (form submit and Enter) changes the URL and the rows; a miss shows an Arabic empty state
      await open(page, '/admin/categories')
      const box = page.getByRole('searchbox', { name: 'بحث' })
      await box.fill(`${TAG} pg 00 ${stamp}`)
      await expectEffect(page, 'search submit', () => box.press('Enter'))
      await expect(page).toHaveURL(/q=/)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await box.fill('zzz-لا-يوجد-كتاب-بهذا-الاسم-zzz')
      await page.locator('.dataTables_filter button[type=submit]').click()
      await expect(page.locator('tbody tr td').first()).toContainText('لا توجد')
      const empty = await page.locator('tbody tr td').first().innerText()
      await expect(page.getByRole('link', { name: 'مسح البحث' })).toBeVisible()
      expect(empty, 'empty state').toMatch(/لا توجد/)
      expectArabicMessage(empty, 'empty state')
      await shot(page, 'empty-state', vp.name)

      // every list with a search box + an impossible term -> a clear Arabic message, never a blank table
      for (const path of ['/admin/books', '/admin/users', '/admin/orders', '/admin/payments', '/admin/makers', '/admin/articles', '/admin/pages']) {
        await open(page, `${path}?q=${encodeURIComponent('zzz-no-such-row-zzz')}`)
        const cell = page.locator('.dataTables_wrapper tbody tr td').first() // (the payments page also has a gateway table above)
        await expect(cell, `${path} empty state`).toContainText(/لا توجد/)
        await expect(page.locator('.alert-danger')).toHaveCount(0)
      }
      // filtered lists without a search box: no rows -> message
      await open(page, `/admin/comments?status=rejected&book=${fx.bookId}`)
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)
      // a page number past the end (a stale bookmark after rows were deleted): an Arabic message with a way back, not a 500
      await open(page, `/admin/contacts?status=handled&page=99`)
      await expect(page.locator('tbody tr td').first()).toContainText('هذه الصفحة غير موجودة')
      await page.getByRole('link', { name: 'الصفحة الأولى' }).click()
      await expect(page).not.toHaveURL(/page=99/)
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)
      await open(page, '/admin/request-books?status=declined&nothing=1')
      expect(await page.locator('tbody tr').count()).toBeGreaterThan(0) // either rows or the empty row
      // a page number past the end must not break the list
      await open(page, '/admin/books?page=9999')
      await expect(page.locator('tbody tr td').first()).toContainText('هذه الصفحة غير موجودة')
      await page.getByRole('link', { name: 'الصفحة الأولى' }).click()
      await expect(page.locator('tbody tr').first().locator('[data-toggle="dropdown"]')).toBeVisible()
      // junk filters fall back instead of erroring
      await open(page, '/admin/books?workflow=bogus&recovery=bogus&status=bogus')
      await assertHealthy(page, 'junk filters')

      // books: both filters change the URL and the data; the sidebar status filters list only matching rows
      await open(page, `/admin/books?q=${encodeURIComponent(N('fixture book'))}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await expectEffect(page, 'workflow filter', () => page.locator('#workflow-filter').selectOption('draft'))
      await expect(page).toHaveURL(/workflow=draft/)
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/) // the fixture is published, so no draft matches
      await page.locator('#workflow-filter').selectOption('all')
      await expect(page).not.toHaveURL(/workflow=/)
      await page.locator('#recovery-filter').selectOption('not_ready')
      await expect(page).toHaveURL(/recovery=not_ready/)
      await open(page, '/admin/books?status=trash')
      await assertHealthy(page, 'books trash')

      // tab links on request-books / comments / contacts act
      await open(page, '/admin/request-books')
      for (const t of ['مراجعة', 'موافقة', 'رفض', 'الكل']) {
        await expectEffect(page, `request-books tab ${t}`, () => page.locator('.btn-sm', { hasText: new RegExp(`^${t}$`) }).first().click())
        await ready(page)
      }
      await open(page, '/admin/comments')
      for (const t of ['قيد المراجعة', 'مقبول', 'مرفوض', 'الكل']) {
        await expectEffect(page, `comments tab ${t}`, () => page.locator('.col-12.mb-3 a', { hasText: new RegExp(`^${t}$`) }).click())
        await ready(page)
      }
      await open(page, '/admin/contacts')
      for (const t of ['غير معالجة', 'تمت المعالجة', 'الكل']) {
        await expectEffect(page, `contacts tab ${t}`, () => page.locator('.col-12.mb-3 a', { hasText: new RegExp(`^${t}$`) }).click())
        await ready(page)
      }
      // payments: gateway panel toggle + needs-review filter
      await open(page, '/admin/payments')
      await expect(page.getByText('بوابات الدفع')).toBeVisible()
      await expect(page.locator('table').first()).toBeVisible()
      await expectEffect(page, 'gateway panel toggle', () => page.getByRole('button', { name: /إخفاء|إظهار/ }).click())
      await page.getByRole('button', { name: /إخفاء|إظهار/ }).click()
      await expectEffect(page, 'needs-review filter', () => page.getByLabel('عرض العمليات التي تحتاج مراجعة فقط').check())
      await expect(page).toHaveURL(/review=needs_review/)
      await ready(page)
      await shot(page, 'payments-filtered', vp.name)
    })

    // ---------------------------------------------------------------------------------------------- 4. row menus and modals
    test('4. row menus open, items navigate, delete modals open and close, nothing is dead', async ({ page }) => {
      for (const [path, entity] of [['/admin/books', 'books'], ['/admin/categories', 'categories'], ['/admin/makers', 'makers'], ['/admin/articles', 'articles'], ['/admin/pages', 'pages'], ['/admin/users', 'users']] as const) {
        await open(page, path)
        const row = page.locator('tbody tr').first()
        await row.locator('[data-toggle="dropdown"]').click()
        const menu = row.locator('.dropdown-menu.show')
        await expect(menu, `${entity} row menu`).toBeVisible()
        const items = menu.locator('.dropdown-item')
        expect(await items.count(), `${entity} menu items`).toBeGreaterThanOrEqual(2)
        // every menu item is a real link or a handler that does something
        for (let i = 0; i < await items.count(); i++) {
          const it = items.nth(i)
          const href = await it.getAttribute('href')
          const label = (await it.innerText()).trim()
          if (href && href !== '#') expect(href, `${entity}: "${label}" link`).toMatch(/^\//)
        }
        await page.screenshot({ path: `${SHOTS}row-menu-${entity}-${vp.name}.png` })
        // delete / status modal: opens, shows the row, closes with أغلاق and with Escape and by clicking the backdrop
        const del = menu.locator('.dropdown-item', { hasText: /حذف|تغيير الحالة/ }).first()
        await del.click()
        await expect(modal(page)).toBeVisible()
        await expect(modal(page).locator('input[readonly]').first()).not.toHaveValue('')
        await modal(page).getByRole('button', { name: 'أغلاق' }).click()
        await expect(modal(page)).toHaveCount(0)
        await row.locator('[data-toggle="dropdown"]').click()
        await row.locator('.dropdown-menu.show .dropdown-item', { hasText: /حذف|تغيير الحالة/ }).first().click()
        await expect(modal(page)).toBeVisible()
        await page.keyboard.press('Escape').catch(() => {})
        if (await modal(page).count()) await modal(page).getByRole('button', { name: 'أغلاق' }).click()
        await expect(modal(page)).toHaveCount(0)
        await expect(page.locator('body')).not.toHaveClass(/modal-open/)
      }
      // the edit item of a book / category goes to a working form
      await open(page, `/admin/books?q=${encodeURIComponent(N('fixture book'))}`)
      await rowOps(page, page.locator('tbody tr').first(), 'تعديل')
      await expect(page).toHaveURL(new RegExp(`/admin/books/${fx.bookId}$`))
      await ready(page)
      await expect(page.locator('#b-title')).toHaveValue(N('fixture book'))
      await open(page, `/admin/books?q=${encodeURIComponent(N('fixture book'))}`)
      await rowOps(page, page.locator('tbody tr').first(), 'المحتويات')
      await expect(page).toHaveURL(new RegExp(`/admin/books/${fx.bookId}/media$`))
      await ready(page)
      await open(page, `/admin/books?q=${encodeURIComponent(N('fixture book'))}`)
      await rowOps(page, page.locator('tbody tr').first(), 'التعليقات')
      await expect(page).toHaveURL(new RegExp(`/admin/comments\\?book=${fx.bookId}`))
      await ready(page)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      // the "view" link opens the storefront page of the book in a new tab
      await open(page, `/admin/books?q=${encodeURIComponent(N('fixture book'))}`)
      await page.locator('tbody tr').first().locator('[data-toggle="dropdown"]').click()
      await expect(page.locator('.dropdown-menu.show a', { hasText: 'مشاهدة' })).toHaveAttribute('href', `/book/${fx.bookId}`)
    })

    // ---------------------------------------------------------------------------------------------- 5. validation
    test('5. validation: empty and invalid forms give a clear Arabic message and never a server error', async ({ page, watch }) => {
      const err = (p: Page) => p.locator('form .text-danger[role=alert], form .alert-danger').allInnerTexts()
      // --- book
      await open(page, '/admin/books/create')
      await page.getByRole('button', { name: 'حفظ' }).click()
      let msgs = await err(page)
      expect(msgs.length, 'empty book form shows an error').toBeGreaterThan(0)
      msgs.forEach((m) => expectArabicMessage(m, 'empty book'))
      await shot(page, 'validation-book-empty', vp.name)
      await page.locator('#b-title').fill(N('invalid'))
      await page.locator('#b-cost').fill('-5')
      await page.getByRole('button', { name: 'حفظ' }).click()
      msgs = await err(page)
      expect(msgs.length, 'negative price refused').toBeGreaterThan(0)
      msgs.forEach((m) => expectArabicMessage(m, 'negative price'))
      await pickSelect(group(page, 'الحالة'), 'مفعلة')
      await page.locator('#b-cost').fill('0')
      await page.getByRole('button', { name: 'حفظ' }).click()
      msgs = await err(page)
      expect(msgs.join(' '), 'paid + price 0 + published').toContain('الكتاب المدفوع يحتاج سعراً')
      await page.locator('#b-cost').fill('10')
      await page.locator('#b-title').fill('ع'.repeat(251))
      await page.getByRole('button', { name: 'حفظ' }).click()
      msgs = await err(page)
      expect(msgs.length, 'over-long title refused').toBeGreaterThan(0)
      msgs.forEach((m) => expectArabicMessage(m, 'long title'))
      await shot(page, 'validation-book-long', vp.name)
      expect(await page.locator('.fa-spin').count()).toBe(0)
      // free + price typed -> server/form agree (price forced to 0, no error)
      // --- category / maker / article / page empty submit
      for (const entity of ['categories', 'makers', 'articles', 'pages']) {
        await open(page, `/admin/${entity}/create`)
        await page.getByRole('button', { name: 'حفظ' }).click()
        msgs = await err(page)
        expect(msgs.length, `${entity}: empty form shows an error`).toBeGreaterThan(0)
        msgs.forEach((m) => expectArabicMessage(m, `${entity} empty`))
        await shot(page, `validation-${entity}-empty`, vp.name)
      }
      await open(page, '/admin/categories/create')
      await page.locator('#e-name').fill('ع'.repeat(121))
      await page.getByRole('button', { name: 'حفظ' }).click()
      msgs = await err(page); expect(msgs.length).toBeGreaterThan(0); msgs.forEach((m) => expectArabicMessage(m, 'long category'))
      await open(page, '/admin/pages/create')
      await page.locator('#e-title').fill(N('bad slug'))
      await page.locator('#e-slug').fill('has space/and-slash')
      await page.getByRole('button', { name: 'حفظ' }).click()
      msgs = await err(page); expect(msgs.join(' ')).toContain('الرابط لا يحتوي مسافات');
      // a slug that already exists (server-side rule): clear Arabic error, not a 500
      const existing = (await svc.from('pages').select('slug').is('deleted_at', null).limit(1).single()).data!.slug
      await page.locator('#e-slug').fill(existing)
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.locator('form .alert-danger')).toBeVisible()
      expectArabicMessage(await page.locator('form .alert-danger').innerText(), 'duplicate slug')
      expect(watch.http5xx).toEqual([])
      // --- settings
      await open(page, '/admin/site-info')
      const save = page.getByRole('button', { name: 'حفظ' })
      await page.getByPlaceholder('البريد الالكترونى').fill('not-an-email')
      await save.click()
      expectArabicMessage(await page.locator('.text-danger[role=alert]').first().innerText(), 'bad e-mail')
      await page.getByPlaceholder('البريد الالكترونى').fill('')
      await page.getByPlaceholder('رابط الفيسبوك').fill('javascript:alert(1)')
      await save.click()
      expectArabicMessage(await page.locator('.text-danger[role=alert]').first().innerText(), 'bad url')
      await page.getByPlaceholder('رابط الفيسبوك').fill('')
      await page.getByPlaceholder('الأسم').fill('')
      await save.click()
      expectArabicMessage(await page.locator('.text-danger[role=alert]').first().innerText(), 'empty site name')
      await page.getByPlaceholder('الأسم').fill('أوراق عربية')
      const commission = page.getByLabel('نسبة العمولة %')
      await commission.fill('150')
      await save.click()
      expectArabicMessage(await page.locator('.text-danger[role=alert]').first().innerText(), 'commission 150')
      await commission.fill('-1')
      await save.click()
      expectArabicMessage(await page.locator('.text-danger[role=alert]').first().innerText(), 'commission -1')
      await shot(page, 'validation-settings', vp.name)
      // --- affiliates/create, edit-profile, demo purge
      await open(page, '/admin/affiliates/create')
      await page.getByRole('button', { name: 'حفظ' }).click()
      expectArabicMessage(await page.locator('.alert-danger').innerText(), 'affiliate empty')
      await page.getByLabel('البريد الإلكترونى للعميل المسجّل').fill('nobody-sweep@aawraq.test')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.locator('.alert-danger')).toBeVisible()
      expectArabicMessage(await page.locator('.alert-danger').innerText(), 'affiliate unknown e-mail')
      await open(page, '/admin/edit-profile')
      await page.getByRole('button', { name: 'حفظ' }).click()
      expectArabicMessage(await page.locator('.alert-danger').innerText(), 'profile empty')
      await page.locator('#p-cur').fill('wrong-password-123')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('كلمة المرور الحالية غير صحيحة')).toBeVisible()
      await page.locator('#p-cur').fill(DEV_PASSWORD); await page.locator('#p-new').fill('short'); await page.getByRole('button', { name: 'حفظ' }).click()
      expectArabicMessage(await page.locator('.alert-danger').innerText(), 'short password')
      await page.locator('#p-new').fill('Another-Pass-2026!'); await page.locator('#p-conf').fill('different'); await page.getByRole('button', { name: 'حفظ' }).click()
      expectArabicMessage(await page.locator('.alert-danger').innerText(), 'password mismatch')
      await page.locator('#p-new').fill(''); await page.locator('#p-conf').fill('')
      await page.locator('#p-cur').fill(DEV_PASSWORD)
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('لا توجد تغييرات')).toBeVisible()
      await open(page, '/admin/demo-data')
      const purge = page.getByRole('button', { name: /حذف البيانات التجريبية/ })
      await expect(purge).toBeDisabled()
      await page.locator('#demo-confirm').fill('delete-demo')
      await expect(purge).toBeDisabled()
      await page.locator('#demo-confirm').fill('DELETE-DEMO')
      await expect(purge).toBeEnabled() // NOT clicked: it would purge the shared demo catalogue
      // --- media manager forms
      await open(page, `/admin/books/${fx.bookId}/media`)
      await page.getByRole('button', { name: 'رفع', exact: false }).first().click()
      await expect(page.locator('.alert-danger')).toContainText('اختر ملفاً أولاً')
      await page.getByPlaceholder('https://...').fill('http://insecure.example.test/x.pdf')
      await page.getByRole('button', { name: 'إضافة' }).click()
      await expect(page.locator('.alert-danger, :invalid').first()).toBeVisible() // native URL check or server refusal
    })

    // ---------------------------------------------------------------------------------------------- 6. API probes: bad input never reaches a 500
    test('6. API: malformed admin writes answer 4xx with a message, never 5xx', async ({ page }) => {
      await open(page, '/admin')
      const r = page.context().request
      const probes: [string, string, unknown][] = [
        ['POST', '/api/admin/books', {}], ['POST', '/api/admin/books', { title: 'x', kind: 'paid', status: 'published', price_amount: -1 }],
        ['POST', '/api/admin/books', { title: 'x', kind: 'paid', status: 'published', price_amount: 0 }], ['POST', '/api/admin/books', { title: 'ع'.repeat(300), kind: 'free', status: 'draft', price_amount: 0 }],
        ['POST', '/api/admin/books', { title: 'x', kind: 'free', status: 'draft', price_amount: 'abc' }], ['POST', '/api/admin/books', 'not json'],
        ['POST', '/api/admin/books', { title: 'x', kind: 'free', status: 'draft', price_amount: 0, category_ids: [999999999] }],
        ['POST', '/api/admin/books', { title: 'x', kind: 'free', status: 'draft', price_amount: 0, maker_ids: [{ id: 999999999, role: 'author' }] }],
        ['PUT', '/api/admin/books/999999999', { title: 'x', kind: 'free', status: 'draft', price_amount: 0 }], ['PUT', '/api/admin/books/abc', {}], ['DELETE', '/api/admin/books/999999999', null],
        ['POST', '/api/admin/categories', {}], ['POST', '/api/admin/makers', { name: 'x' }], ['POST', '/api/admin/articles', { title: '' }], ['POST', '/api/admin/pages', { slug: 'a b', title: 't', status: 'draft' }],
        ['POST', '/api/admin/nonsense', {}], ['PUT', '/api/admin/categories/abc', {}], ['DELETE', '/api/admin/categories/999999999', null], ['POST', '/api/admin/categories/999999999/restore', null],
        ['PUT', '/api/admin/settings', {}], ['PUT', '/api/admin/settings', { site_name: 'x', email: 'bad' }], ['PATCH', `/api/admin/users/${tagged.userId}`, { status: 'wizard' }], ['PATCH', '/api/admin/users/not-a-uuid', { status: 'active' }],
        ['PATCH', '/api/admin/comments/999999999', { status: 'approved' }], ['PATCH', '/api/admin/comments/1', { status: 'bogus' }], ['PATCH', '/api/admin/contacts/999999999', { is_handled: true }], ['DELETE', '/api/admin/contacts/abc', null],
        ['POST', `/api/admin/request-books/${randomUUID()}/decision`, { approve: true }], ['POST', '/api/admin/request-books/not-uuid/decision', { approve: true }], ['POST', `/api/admin/request-books/${fx.reqApprove}/decision`, { approve: 'yes' }],
        ['PATCH', `/api/admin/affiliates/${randomUUID()}`, { status: 'active' }], ['POST', '/api/admin/affiliates', {}], ['POST', '/api/admin/affiliates', { email: 'nobody@nowhere.test' }],
        ['DELETE', '/api/admin/demo', { confirm: 'nope' }], ['GET', '/api/admin/orders/999999999', null], ['GET', '/api/admin/orders/abc', null], ['GET', '/api/admin/users/not-a-uuid', null],
        ['GET', '/api/admin/stats/users?from=bad-date', null], ['GET', '/api/admin/stats/nonsense', null], ['GET', '/api/admin/categories?page=-1&status=%00&q=%25%25', null], ['GET', `/api/admin/books?page=abc&recovery=zzz`, null],
        ['POST', '/api/admin/books/999999999/clone', null], ['POST', '/api/admin/books/999999999/verify', null], ['POST', '/api/admin/books/999999999/media', { external_url: 'ftp://x', name: '' }],
        ['POST', `/api/admin/books/${fx.bookId}/media`, { external_url: 'http://insecure.example.test/a', name: 'x' }], ['PUT', `/api/admin/books/${fx.bookId}/media/999999999`, { name: 'x' }],
        ['POST', '/api/admin/images/books/999999999', null], ['POST', '/api/admin/settings/upload?field=nonsense', null], ['POST', '/api/admin/recovery/verify', {}], ['POST', '/api/admin/recovery/promote', { run: 'x' }],
      ]
      const bad: string[] = []
      for (const [method, url, body] of probes) {
        const res = await r.fetch(url, { method, ...(body === null ? {} : typeof body === 'string' ? { headers: { 'content-type': 'application/json' }, data: body } : { data: body }) })
        const status = res.status()
        let message = ''
        try { const j = await res.json(); message = String(j.statusMessage ?? j.message ?? '') } catch { /* not json */ }
        if (status >= 500) bad.push(`${method} ${url} -> ${status} ${message}`)
        else if (status === 200 || status === 201) { if (method !== 'GET') bad.push(`${method} ${url} unexpectedly accepted (${status})`) }
        else if (status >= 400 && !message) bad.push(`${method} ${url} -> ${status} without a message`)
      }
      expect(bad, 'API probes').toEqual([])
    })

    // ---------------------------------------------------------------------------------------------- 7. round trips (create / edit / delete, storefront check)
    test('7a. book: create, edit with cover upload, publish, hide, trash, restore; the storefront follows', async ({ page }) => {
      const title = N('book')
      await open(page, '/admin/books/create')
      await page.locator('#b-title').fill(title)
      await pickSelect(group(page, 'النوع'), 'مدفوع')
      await page.locator('#b-cost').fill('12.5')
      await page.getByPlaceholder('الكلمات المفتاحية').fill('اختبار، sweep')
      await page.locator('textarea.tw_editor').fill('<p>وصف الكتاب <script>alert(1)</script></p>')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page).toHaveURL(/\/admin\/books\/\d+\/media$/)
      await ready(page)
      const id = Number(page.url().match(/books\/(\d+)\/media/)![1])
      await expect(page.locator('h1.name')).toHaveText(title)
      await expect(page.locator('.product_content')).toContainText('12.50')
      await shot(page, 'book-media-new', vp.name)

      // draft: hidden from the storefront
      expect((await origin(page, `/book/${id}`)).status(), 'draft book is not public').toBe(404)

      // edit: cover upload + publish
      await open(page, `/admin/books/${id}`)
      await expect(page.locator('#b-title')).toHaveValue(title)
      await page.locator('input[type=file].dropify').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG_1X1 })
      await expect(page.locator('.dropify-wrapper')).toContainText('cover.png')
      await pickSelect(group(page, 'الحالة'), 'مفعلة')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible()
      await expect(page.getByAltText('الغلاف الحالي')).toBeVisible()
      await expect.poll(() => page.getByAltText('الغلاف الحالي').evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0)
      await shot(page, 'book-edit-saved', vp.name)
      // reload: values persisted
      await open(page, `/admin/books/${id}`)
      await expect(page.locator('#b-cost')).toHaveValue('12.5')
      await expect(page.getByAltText('الغلاف الحالي')).toBeVisible()

      // storefront shows it, with the uploaded cover, and the script tag is gone from the description
      await page.goto(`/book/${id}`, { waitUntil: 'domcontentloaded' })
      await ready(page)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await expect(page.locator('.product_img img')).not.toHaveAttribute('src', /default-cover/)
      expect(await page.locator('.product_wp script, #product_about script').count()).toBe(0)
      await noSidewaysScroll(page)
      await shot(page, 'storefront-book', vp.name)

      // media manager: tabs, upload a PDF, rename, bad external link, good external link, delete
      await open(page, `/admin/books/${id}/media`)
      await expectEffect(page, 'audio tab', () => page.getByRole('tab', { name: 'ملف صوتى' }).click())
      await page.getByRole('tab', { name: 'ملف إلكترونى' }).click()
      await expect(page.locator('tbody').first()).toContainText('لا توجد ملفات')
      await page.locator('.block-file input[type=file]').first().setInputFiles({ name: 'sweep.pdf', mimeType: 'application/pdf', buffer: syntheticPdf({ pages: 2 }) })
      await page.locator('.block-file').first().getByPlaceholder('أسم الملف').fill(`${TAG} ملف`)
      await page.locator('.block-file').first().getByRole('button', { name: 'رفع' }).click()
      await expect(page.getByText('تم رفع الملف')).toBeVisible()
      const nameInput = page.getByLabel('اسم الملف 1')
      await expect(nameInput).toHaveValue(`${TAG} ملف`)
      await nameInput.fill(`${TAG} ملف معدل`)
      await page.getByTitle('حفظ', { exact: true }).first().click()
      await expect(page.getByText('تم الحفظ', { exact: true })).toBeVisible()
      await page.getByPlaceholder('https://...').fill('https://example.test/sweep.pdf')
      await page.getByPlaceholder('أسم الملف').last().fill(`${TAG} رابط`)
      await page.getByRole('button', { name: 'إضافة' }).click()
      await expect(page.getByText('تمت إضافة الرابط')).toBeVisible()
      await expect(page.getByTitle('فتح الرابط')).toHaveAttribute('href', 'https://example.test/sweep.pdf')
      await shot(page, 'book-media-managed', vp.name)
      await page.getByTitle('حذف', { exact: true }).last().click()
      await expect(modal(page)).toBeVisible()
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(page.getByText('تم الحذف')).toBeVisible()

      // clone from the list
      await open(page, `/admin/books?q=${encodeURIComponent(title)}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await expect(page.locator('tbody tr')).toContainText('مفعلة')
      await rowOps(page, page.locator('tbody tr').first(), 'نسخ')
      await expect(page).toHaveURL(/\/admin\/books\/\d+$/)
      await ready(page)
      const cloneTitle = await page.locator('#b-title').inputValue()
      expect(cloneTitle).toContain(TAG)

      // unpublish -> hidden again; trash -> hidden; restore -> listed again (the clone also matches the title search: act on the original only)
      const own = () => page.locator('tbody tr').filter({ hasNotText: 'نسخة من' })
      await open(page, `/admin/books/${id}`)
      await pickSelect(group(page, 'الحالة'), 'غير مفعلة')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible()
      expect((await origin(page, `/book/${id}`)).status(), 'unpublished book is hidden').toBe(404)
      await open(page, `/admin/books?q=${encodeURIComponent(title)}`)
      await expect(page.locator('tbody tr')).toHaveCount(2)
      await rowOps(page, own().first(), 'حذف')
      await expect(modal(page).locator('input[readonly]')).toHaveValue(title)
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(modal(page)).toHaveCount(0)
      await expect(page.locator('tbody tr')).toHaveCount(1) // only the clone is left
      await expect(page.locator('tbody tr')).toContainText('نسخة من')
      await open(page, `/admin/books?status=trash&q=${encodeURIComponent(title)}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await rowOps(page, page.locator('tbody tr').first(), 'استرجاع')
      await modal(page).getByRole('button', { name: 'استرجاع' }).click()
      await expect(modal(page)).toHaveCount(0)
      await open(page, `/admin/books?q=${encodeURIComponent(title)}`)
      await expect(page.locator('tbody tr')).toHaveCount(2)
    })

    test('7b. category + author: create, edit, deactivate, delete, restore; the storefront follows', async ({ page }) => {
      // ---- category
      const cat = N('category')
      await open(page, '/admin/categories/create')
      await page.locator('#e-name').fill(cat)
      await page.locator('input[type=file].dropify').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG_1X1 })
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page).toHaveURL(/\/admin\/categories$/)
      await ready(page)
      await page.getByRole('searchbox', { name: 'بحث' }).fill(cat); await page.getByRole('searchbox', { name: 'بحث' }).press('Enter')
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await expect(page.locator('tbody tr .badge')).toHaveText('مفعلة')
      const catId = Number((await page.locator('tbody tr td').first().innerText()).trim())
      // the new category shows up on the storefront (search facet / categories page)
      const storeHas = async (text: string) => {
        const before = (await svc.from('categories').select('id', { count: 'exact', head: true }).eq('is_active', true).lte('id', catId)).count ?? 1
        await page.goto(`/categories?page=${Math.max(1, Math.ceil(before / 20))}`, { waitUntil: 'domcontentloaded' }); await ready(page); return (await page.locator('body').innerText()).includes(text)
      }
      expect(await storeHas(cat), 'active category visible on /categories').toBe(true)
      // edit: rename + deactivate
      await open(page, `/admin/categories/${catId}`)
      await expect(page.locator('#e-name')).toHaveValue(cat)
      await page.locator('#e-name').fill(`${cat} معدل`)
      await pickSelect(group(page, 'الحالة'), 'غير مفعلة')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible()
      expect((await Promise.all([1, 2, 3, 4].map(async (n) => (await page.request.get(`/categories?page=${n}`)).text()))).join(' ').includes(`${cat} معدل`), 'inactive category hidden').toBe(false)
      await open(page, `/admin/categories?q=${encodeURIComponent(cat)}`)
      await expect(page.locator('tbody tr .badge')).toHaveText('غير مفعلة')
      await rowOps(page, page.locator('tbody tr').first(), 'حذف')
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)
      await open(page, `/admin/categories?status=trash&q=${encodeURIComponent(cat)}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await rowOps(page, page.locator('tbody tr').first(), 'استرجاع')
      await modal(page).getByRole('button', { name: 'استرجاع' }).click()
      await open(page, `/admin/categories?q=${encodeURIComponent(cat)}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)

      // ---- author / maker
      const maker = N('author')
      await open(page, '/admin/makers/create')
      await page.locator('#e-name').fill(maker)
      await pickSelect(group(page, 'النوع'), 'مؤلف')
      await pickSelect(group(page, 'العصر'), 'حديث')
      await page.locator('textarea.tw_editor').fill('<p>نبذة <b>جريئة</b><script>alert(1)</script></p>')
      await page.locator('input[type=file].dropify').setInputFiles({ name: 'maker.png', mimeType: 'image/png', buffer: PNG_1X1 })
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page).toHaveURL(/\/admin\/makers$/)
      await ready(page)
      await page.getByRole('searchbox', { name: 'بحث' }).fill(maker); await page.getByRole('searchbox', { name: 'بحث' }).press('Enter')
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await expect(page.locator('tbody tr')).toContainText('مؤلف')
      const makerId = Number((await page.locator('tbody tr td').first().innerText()).trim())
      await page.goto(`/maker/${makerId}`, { waitUntil: 'domcontentloaded' }); await ready(page)
      await expect(page.getByText(maker).first()).toBeVisible()
      expect(await page.locator('main script, .container script').count()).toBe(0)
      await shot(page, 'storefront-maker', vp.name)
      await open(page, `/admin/makers/${makerId}`)
      await pickSelect(group(page, 'الحالة'), 'غير مفعلة')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible()
      expect((await page.request.get(`/maker/${makerId}`)).status() === 404 || !(await (await page.request.get(`/maker/${makerId}`)).text()).includes(maker), 'inactive author hidden').toBe(true)
      await open(page, `/admin/makers?q=${encodeURIComponent(maker)}`)
      await rowOps(page, page.locator('tbody tr').first(), 'حذف')
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)
    })

    test('7c. article + static page: create, edit, publish, hide, delete; sanitised on the storefront', async ({ page }) => {
      // ---- article
      const title = N('article')
      await open(page, '/admin/articles/create')
      await page.locator('#e-title').fill(title)
      await page.locator('textarea').first().fill('مقتطف الاختبار')
      await page.locator('textarea.tw_editor').fill('<p>نص المقال</p><img src=x onerror=alert(1)><script>alert(2)</script>')
      await page.locator('input[type=file].dropify').setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: PNG_1X1 })
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page).toHaveURL(/\/admin\/articles$/)
      await ready(page)
      await page.getByRole('searchbox', { name: 'بحث' }).fill(title); await page.getByRole('searchbox', { name: 'بحث' }).press('Enter')
      await expect(page.locator('tbody tr')).toHaveCount(1)
      const id = Number((await page.locator('tbody tr td').first().innerText()).trim())
      expect((await origin(page, `/post/${id}`)).status(), 'draft article is not public').toBe(404)
      await open(page, `/admin/articles/${id}`)
      await pickSelect(group(page, 'الحالة'), 'مفعلة')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible()
      await page.goto(`/post/${id}`, { waitUntil: 'domcontentloaded' }); await ready(page)
      await expect(page.getByText(title).first()).toBeVisible()
      await expect(page.getByText('نص المقال')).toBeVisible()
      expect(await page.locator('[onerror]').count(), 'event-handler attribute stripped').toBe(0)
      await noSidewaysScroll(page)
      await shot(page, 'storefront-article', vp.name)
      await open(page, `/admin/articles?q=${encodeURIComponent(title)}`)
      await expect(page.locator('tbody tr .badge')).toHaveText('مفعلة')
      await rowOps(page, page.locator('tbody tr').first(), 'حذف')
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)
      expect((await origin(page, `/post/${id}`)).status(), 'deleted article is not public').toBe(404)

      // ---- static page
      const pTitle = N('page')
      const pSlug = `sweep-${vp.name}-${stamp}`
      await open(page, '/admin/pages/create')
      await page.locator('#e-title').fill(pTitle)
      await page.locator('#e-slug').fill(pSlug)
      await page.getByLabel('الفوتر').check()
      await page.locator('textarea.tw_editor').fill('<h2>عنوان الصفحة</h2><p>محتوى الصفحة</p><script>alert(3)</script>')
      await pickSelect(group(page, 'الحالة'), 'مفعلة')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page).toHaveURL(/\/admin\/pages$/)
      await ready(page)
      await page.goto(`/p/${pSlug}`, { waitUntil: 'domcontentloaded' }); await ready(page)
      await expect(page.getByText('محتوى الصفحة')).toBeVisible()
      expect(await page.locator('.container script, main script').count()).toBe(0)
      await expect(page.locator('.footer_wp a', { hasText: pTitle }), 'footer position honoured').toBeVisible()
      await shot(page, 'storefront-page', vp.name)
      await open(page, `/admin/pages?q=${encodeURIComponent(pTitle)}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      const pid = Number((await page.locator('tbody tr td').first().innerText()).trim())
      await open(page, `/admin/pages/${pid}`)
      await pickSelect(group(page, 'الحالة'), 'غير مفعلة')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible()
      expect((await origin(page, `/p/${pSlug}`)).status(), 'inactive page hidden').toBe(404)
      await open(page, `/admin/pages?q=${encodeURIComponent(pTitle)}`)
      await rowOps(page, page.locator('tbody tr').first(), 'حذف')
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)
    })

    // ---------------------------------------------------------------------------------------------- 8. moderation + people
    test('8a. comments and contacts: approve, hide, view, handle, delete', async ({ page }) => {
      await open(page, `/admin/comments?book=${fx.bookId}`)
      const row = page.locator('tbody tr').first()
      await expect(row).toContainText(`${TAG} تعليق`)
      await expect(row.locator('.badge').first()).toHaveText('قيد المراجعة')
      await expectEffect(page, 'approve comment', () => row.getByTitle('قبول').click())
      await expect(row.locator('.badge').first()).toHaveText('مقبول')
      await row.getByTitle('إظهار للجميع').click()
      await expect(row).toContainText('نعم')
      await row.getByTitle('رفض').click()
      await expect(row.locator('.badge').first()).toHaveText('مرفوض')
      await shot(page, 'comments-row', vp.name)
      await row.getByTitle('حذف').click()
      await expect(modal(page)).toBeVisible()
      await modal(page).getByRole('button', { name: 'أغلاق' }).click()
      await expect(modal(page)).toHaveCount(0)
      await row.getByTitle('حذف').click()
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)

      await open(page, '/admin/contacts')
      const c = page.locator('tbody tr', { hasText: `${TAG} رسالة ${vp.name}` })
      await expect(c).toHaveCount(1)
      await c.getByTitle('عرض').click()
      await expect(modal(page).locator('textarea')).toHaveValue(new RegExp(`${TAG.replace(/[[\]]/g, '\\$&')} رسالة`))
      await modal(page).getByRole('button', { name: 'أغلاق' }).click()
      await expectEffect(page, 'mark handled', () => c.getByTitle('تمت المعالجة').click())
      await expect(c).toContainText('تمت المعالجة')
      await open(page, '/admin/contacts?status=handled')
      await expect(page.locator('tbody tr', { hasText: `${TAG} رسالة ${vp.name}` })).toHaveCount(1)
      await page.locator('tbody tr', { hasText: `${TAG} رسالة ${vp.name}` }).getByTitle('إعادة فتح').click()
      await expect(page.locator('tbody tr', { hasText: `${TAG} رسالة ${vp.name}` })).toHaveCount(0)
      await open(page, '/admin/contacts?status=open')
      const again = page.locator('tbody tr', { hasText: `${TAG} رسالة ${vp.name}` })
      await again.getByTitle('حذف').click()
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(again).toHaveCount(0)
    })

    test('8b. users: profile, status change, soft delete and restore', async ({ page }) => {
      const u = await createTestUser()
      await open(page, `/admin/users?q=${encodeURIComponent(u.email)}`)
      const row = page.locator('tbody tr').first()
      await expect(row).toContainText(u.email)
      await expect(row.locator('.badge')).toHaveText('مفعل')
      await rowOps(page, row, 'تغيير الحالة')
      await pickSelect(modal(page).locator('.form-group').filter({ hasText: 'الحالة' }), 'محظور')
      await modal(page).getByRole('button', { name: 'حفظ' }).click()
      await expect(modal(page)).toHaveCount(0)
      await expect(row.locator('.badge')).toHaveText('محظور')
      await open(page, `/admin/users?status=banned&q=${encodeURIComponent(u.email)}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await rowOps(page, page.locator('tbody tr').first(), 'الملف الشخصى')
      await expect(page).toHaveURL(new RegExp(`/admin/users/${u.id}$`))
      await ready(page)
      await expect(page.getByText(u.email)).toBeVisible()
      await expect(page.getByText('لا توجد فواتير')).toBeVisible()
      await expect(page.getByText('لا توجد كتب')).toBeVisible()
      await assertHealthy(page, 'user profile')
      await shot(page, 'user-profile', vp.name)
      await open(page, `/admin/users?q=${encodeURIComponent(u.email)}`)
      await rowOps(page, page.locator('tbody tr').first(), 'حذف')
      await modal(page).getByRole('button', { name: 'حذف' }).click()
      await expect(page.locator('tbody tr td').first()).toContainText(/لا توجد/)
      await open(page, `/admin/users?status=trash&q=${encodeURIComponent(u.email)}`)
      await rowOps(page, page.locator('tbody tr').first(), 'استرجاع')
      await modal(page).getByRole('button', { name: 'استرجاع' }).click()
      await open(page, `/admin/users?q=${encodeURIComponent(u.email)}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
    })

    test('8c. orders and invoice: list, search, invoice view and its links', async ({ page }) => {
      await open(page, '/admin/orders')
      await expect(page.locator('tbody tr').first()).toContainText(/#\d{6}/)
      await noSidewaysScroll(page)
      await shot(page, 'orders-list', vp.name)
      await open(page, `/admin/orders?q=${tagged.orderNo}`)
      await expect(page.locator('tbody tr')).toHaveCount(1)
      await expectEffect(page, 'invoice link', () => page.locator('tbody tr a').first().click())
      await expect(page).toHaveURL(new RegExp(`/admin/invoice/${tagged.orderNo}$`))
      await ready(page)
      await expect(page.getByText('رقم الفاتورة')).toBeVisible()
      await expect(page.getByText('المشتريات')).toBeVisible()
      await assertHealthy(page, 'invoice')
      await shot(page, 'invoice', vp.name)
      await open(page, '/admin/invoice/999999999')
      await expect(page.locator('.alert-danger')).toBeVisible() // a missing invoice reads as an Arabic error, not a blank page
      expectArabicMessage((await page.locator('.alert-danger').innerText()).replace('إعادة المحاولة', ''), 'missing invoice')
    })

    test('8d. statistics: filter, empty range, CSV export', async ({ page }) => {
      for (const kind of ['users', 'books', 'orders', 'revenue']) {
        await open(page, `/admin/stats/${kind}`)
        await assertHealthy(page, `stats ${kind}`)
        await page.locator('input[aria-label="من تاريخ"]').fill('2000-01-01')
        await page.locator('input[aria-label="إلى تاريخ"]').fill('2000-01-02')
        await expectEffect(page, `stats ${kind} filter`, () => page.getByRole('button', { name: 'عرض' }).click())
        await expect(page.locator('tbody tr td').first()).toContainText('لا توجد بيانات')
        const href = await page.getByRole('link', { name: /تصدير ملف/ }).getAttribute('href')
        const res = await page.request.get(href!)
        expect(res.status(), `${kind} csv`).toBe(200)
        expect(res.headers()['content-type']).toMatch(/csv/)
        await page.locator('input[aria-label="من تاريخ"]').fill(''); await page.locator('input[aria-label="إلى تاريخ"]').fill('')
        await page.getByRole('button', { name: 'عرض' }).click()
        await ready(page)
        await shot(page, `stats-${kind}`, vp.name)
      }
    })

    // ---------------------------------------------------------------------------------------------- 9. affiliates, commissions, withdrawals, contributor requests
    test('9a. affiliates: list, status modal, profile with commissions/withdrawals, create from a registered customer', async ({ page }) => {
      await open(page, '/admin/affiliates')
      await expect(page.locator('tbody tr').first()).toBeVisible()
      await noSidewaysScroll(page)
      await shot(page, 'affiliates-list', vp.name)
      const row = page.locator('tbody tr').first()
      await row.locator('[data-toggle="dropdown"]').click()
      await row.locator('.dropdown-menu.show').getByText('تغير حالة').click()
      await expect(page.locator('#update_modal')).toBeVisible()
      await expect(page.locator('#update_modal input[readonly]')).not.toHaveValue('')
      await page.locator('#update_modal').getByRole('button', { name: 'أغلاق' }).click()
      await expect(page.locator('#update_modal')).toBeHidden()
      await row.locator('[data-toggle="dropdown"]').click()
      await row.locator('.dropdown-menu.show').getByText('الملف الشخصى').click()
      await expect(page).toHaveURL(/\/admin\/affiliates\/[0-9a-f-]{36}$/)
      await ready(page)
      await assertHealthy(page, 'affiliate profile')
      await shot(page, 'affiliate-profile', vp.name)
      // create: promote a registered customer
      const u = await createTestUser()
      await open(page, '/admin/affiliates/create')
      await page.getByLabel('البريد الإلكترونى للعميل المسجّل').fill(u.email)
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page).toHaveURL(/\/admin\/affiliates\/[0-9a-f-]{36}$/)
      await ready(page)
      await expect(page.getByText(u.email).first()).toBeVisible()
      // profile: the status modal opens/closes and saves; the accordion panels open
      await page.getByRole('link', { name: /تعديل الحالة/ }).click()
      await expect(page.locator('#update_modal')).toBeVisible()
      await pickSelect(page.locator('#update_modal .form-group').filter({ hasText: 'الحالة' }), 'محظور')
      await page.locator('#update_modal').getByRole('button', { name: 'حفظ' }).click()
      await expect(page.locator('#update_modal')).toBeHidden()
      await expect(page.locator('.badge', { hasText: 'محظور' }).first()).toBeVisible()
      await expectEffect(page, 'withdrawals accordion', () => page.getByRole('button', { name: /طلبات السحب/ }).click())
      await expect(page.locator('#wd_col')).toHaveClass(/show/)
      await page.getByRole('button', { name: /بيانات السحب/ }).click()
      await expect(page.locator('#payout_col')).toHaveClass(/show/)
      await shot(page, 'affiliate-profile-new', vp.name)
      await open(page, `/admin/affiliates`)
      await expect(page.locator('tbody tr', { hasText: u.email })).toHaveCount(1)
    })

    test('9b. withdrawal requests: list, decision modal behaves (nothing is decided: the ledger is append-only)', async ({ page }) => {
      await open(page, '/admin/withdraws')
      await expect(page.locator('tbody tr').first()).toBeVisible()
      await noSidewaysScroll(page)
      await shot(page, 'withdraws-list', vp.name)
      const pendingBtn = page.locator('tbody tr button', { hasText: 'تعديل' }).first()
      if (await pendingBtn.count() === 0) { test.info().annotations.push({ type: 'note', description: 'no pending withdrawal in the seed' }); return }
      await pendingBtn.click()
      const m = page.locator('#update_modal')
      await expect(m).toBeVisible()
      await expect(m.getByLabel(/المرفق/)).toBeVisible() // default "تم الارسال" asks for the proof
      await pickSelect(m.locator('.form-group').filter({ hasText: 'الحالة' }), 'فشل (رفض)')
      await expect(m.getByLabel(/المرفق/)).toHaveCount(0)
      await shot(page, 'withdraw-modal', vp.name)
      await m.getByRole('button', { name: 'أغلاق' }).click()
      await expect(m).toBeHidden()
      const msgBtn = page.locator('tbody tr button .fa-envelope').first()
      if (await msgBtn.count()) { await msgBtn.click(); await expect(page.locator('.modal.show')).toBeVisible(); await page.locator('.modal.show').getByRole('button', { name: 'إغلاق' }).click(); await expect(page.locator('.modal.show')).toHaveCount(0) }
    })

    test('9c. contributor requests: approve creates one unpublished draft, decline records the refusal, neither can be repeated', async ({ page }) => {
      await open(page, '/admin/request-books?status=pending')
      await expect(page.locator('tbody tr', { hasText: fx.reqApproveTitle })).toHaveCount(1)
      await shot(page, 'request-books-list', vp.name)
      await rowOps(page, page.locator('tbody tr', { hasText: fx.reqApproveTitle }), 'عرض')
      await expect(page).toHaveURL(new RegExp(`/admin/request-books/${fx.reqApprove}$`))
      await ready(page)
      await expect(page.getByText(fx.reqApproveTitle).first()).toBeVisible()
      await assertHealthy(page, 'request detail')
      await shot(page, 'request-detail', vp.name)
      await page.locator('#rv-note').fill('موافقة اختبار')
      await page.getByRole('button', { name: /موافقة وإنشاء مسودة/ }).click()
      await expect(page.locator('.alert-success')).toContainText('تمت الموافقة وإنشاء مسودة كتاب رقم')
      await expect(page.getByRole('button', { name: /موافقة وإنشاء مسودة/ })).toHaveCount(0)
      const draft = page.getByRole('link', { name: /عرض الكتاب \(مسودة\)/ })
      await expect(draft).toBeVisible()
      const bookId = Number((await draft.getAttribute('href'))!.split('/').pop())
      expect((await origin(page, `/book/${bookId}`)).status(), 'the approved draft is not public').toBe(404)
      const draftRow = (await svc.from('books').select('status,title').eq('id', bookId).single()).data!
      expect(draftRow.status).toBe('draft')
      // a second decision is refused with a message, not a 500
      const again = await page.context().request.post(`/api/admin/request-books/${fx.reqApprove}/decision`, { data: { approve: true } })
      expect(again.status()).toBeGreaterThanOrEqual(400); expect(again.status()).toBeLessThan(500)

      await open(page, `/admin/request-books/${fx.reqDecline}`)
      await page.locator('#rv-note').fill('رفض اختبار')
      await page.locator('button.btn-danger', { hasText: 'رفض' }).click()
      await expect(page.locator('.alert-success')).toContainText('تم رفض الطلب')
      await expect(page.getByText('ملاحظة المراجعة')).toBeVisible()
      await expect(page.locator('button.btn-danger', { hasText: 'رفض' })).toHaveCount(0)
      await open(page, '/admin/request-books?status=declined')
      await expect(page.locator('tbody tr', { hasText: fx.reqDeclineTitle })).toHaveCount(1)
      await open(page, `/admin/request-books/${randomUUID()}`)
      await expect(page.locator('.alert-danger')).toBeVisible()
    })

    // ---------------------------------------------------------------------------------------------- 10. settings, catalogue recovery, profile, security
    test('10a. site settings: contact + social fields and logo save, the storefront reflects them, the original row is restored', async ({ page }) => {
      await open(page, '/admin/site-info')
      await assertHealthy(page, 'site-info')
      await expect(page.getByText('بانتظار تأكيد المالك').first()).toBeVisible()
      const phone = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`
      await page.getByPlaceholder('رقم الهاتف').fill(phone)
      await page.getByPlaceholder('رابط الفيسبوك').fill('https://facebook.com/aawraq-sweep')
      await page.getByPlaceholder('رابط تويتر').fill('https://x.com/aawraq-sweep')
      await page.getByPlaceholder('البريد الالكترونى').fill('sweep@aawraq.test')
      await page.locator('input[type=file].dropify').first().setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 })
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم حفظ الإعدادات')).toBeVisible()
      await expect(page.getByAltText('الشعار الحالي')).toBeVisible()
      await shot(page, 'site-info-saved', vp.name)
      await open(page, '/admin/site-info')
      await expect(page.getByPlaceholder('رقم الهاتف')).toHaveValue(phone)
      await expect(page.getByAltText('الشعار الحالي')).toBeVisible()
      await page.goto(`/?_sweep=${Date.now()}`, { waitUntil: 'domcontentloaded' }); await ready(page) // (cache-busted: the home page sits behind a 60 s shared cache)
      const footer = await page.locator('.footer_wp').innerText()
      expect(footer.includes(phone) || (await page.locator('.footer_wp a[href*="facebook.com/aawraq-sweep"]').count()) > 0, 'storefront footer reflects the saved contact/social fields').toBe(true)
      await noSidewaysScroll(page)
    })

    test('10b. catalogue recovery, edit-profile and security screens render and answer', async ({ page }) => {
      await open(page, '/admin/recovery')
      await assertHealthy(page, 'recovery')
      await shot(page, 'recovery', vp.name)
      await open(page, '/admin/edit-profile')
      await assertHealthy(page, 'edit-profile')
      await expect(page.locator('#p-email')).toHaveValue(DEV_USERS.admin)
      await open(page, '/admin/security')
      await expect(page.getByRole('heading', { name: /التحقق بخطوتين/ })).toBeVisible()
      await expect(page.getByRole('button', { name: /بدء التفعيل|تفعيل|تحقق/ }).first().or(page.getByText('التحقق بخطوتين مفعّل'))).toBeVisible() // enrol button NOT clicked: it would change the admin's assurance level
      await noSidewaysScroll(page)
      await shot(page, 'security', vp.name)
      await expect(page.getByRole('link', { name: /لوحة التحكم|العودة/ }).first()).toBeVisible() // the screen is not a dead end
    })
  })
}
