// Real BROWSER journeys through the UI (no API shortcuts) at 1440 / 768 / 390, against the LOCAL dev server + LOCAL Supabase.
//   npx playwright test -c tests/e2e/playwright.config.ts journeys
// Every journey asserts visible Arabic states, no sideways page scroll and no Vue "hydration" console warnings.
// Fixtures are tagged "[journey-test]" and removed afterwards; purchases use fresh @aawraq.test users (orders are immutable, users stay).
// Needs: seeded demo data (scripts/dev/seed-dev.mjs), site_settings.allow_test_payments = true and admin MFA off (the dev defaults).
import { test as base, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { anonClient, DEV_PASSWORD, DEV_USERS, serviceClient, sessionCookieHeader } from '../helpers/supabase'
import { createTestUser, demoPaidBooks } from '../helpers/commerce'

const VIEWPORTS = [{ name: '1440', width: 1440, height: 900 }, { name: '768', width: 768, height: 1024 }, { name: '390', width: 390, height: 844 }] as const
const SHOTS = new URL('../../test-results/journeys/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const TAG = '[journey-test]'
const svc = serviceClient()

/** Fails the test on any Vue hydration console warning or uncaught page error. */
const test = base.extend<{ watch: { hydration: string[]; errors: string[] } }>({
  watch: [async ({ page }, use) => {
    const w = { hydration: [] as string[], errors: [] as string[] }
    page.on('console', (m) => { if (/hydrat/i.test(m.text())) w.hydration.push(m.text().split('\n')[0]!.slice(0, 200)) })
    page.on('pageerror', (e) => w.errors.push(e.message.slice(0, 200)))
    await use(w)
    expect(w.hydration, 'hydration warnings').toEqual([])
    expect(w.errors, 'uncaught page errors').toEqual([])
  }, { auto: true }],
})

let paid: { id: number; title: string; price: number }[] = []
let freeNoFilesId = 0
let freePendingId = 0
const adminCreated: number[] = []

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  const rows = await demoPaidBooks(4)
  const { data } = await svc.from('books').select('id,title,price_amount').in('id', rows.map((r) => r.id))
  paid = rows.map((r) => ({ id: r.id, price: r.price, title: data!.find((b) => b.id === r.id)!.title }))
  // storefront fixtures: a free published book with NO files at all, and one whose only file is still being prepared
  freeNoFilesId = (await svc.from('books').insert({ title: `${TAG} free-no-files`, kind: 'free', status: 'published', price_amount: 0, is_demo: true } as never).select('id').single()).data!.id
  freePendingId = (await svc.from('books').insert({ title: `${TAG} free-pending-file`, kind: 'free', status: 'published', price_amount: 0, is_demo: true } as never).select('id').single()).data!.id
  await svc.from('book_media').insert({ book_id: freePendingId, name: `${TAG} pending`, kind: 'file', visibility: 'after_purchase', migration_status: 'pending', storage_path: null } as never)
})
test.afterAll(async () => {
  for (const id of adminCreated) await svc.from('books').delete().eq('id', id)
  await svc.from('books').delete().like('title', `${TAG}%`) // also covers anything a failed run left behind
})

async function cookiesFor(email: string) {
  const { data, error } = await anonClient().auth.signInWithPassword({ email, password: DEV_PASSWORD })
  if (error || !data.session) throw new Error(error?.message)
  return sessionCookieHeader(data.session).split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' } })
}
/** The page has hydrated (v-model / @submit handlers exist) and no loading spinner is left. */
async function ready(page: Page) {
  await page.waitForFunction(() => (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp?.().isHydrating === false, null, { timeout: 20_000 })
  await expect(page.locator('.fa-spin')).toHaveCount(0, { timeout: 15_000 })
}
async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await ready(page)
}
const noSidewaysScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'horizontal page scroll (px)').toBeLessThanOrEqual(1)
const shot = (page: Page, name: string, vp: string) => page.screenshot({ path: `${SHOTS}${name}-${vp}.png`, fullPage: true })

/** Signs in through the /login form (the real UI), then waits for the post-login redirect. */
async function loginViaForm(page: Page, email: string, expectedUrl: RegExp = /\/$/) {
  await open(page, '/login')
  await page.getByLabel('البريد الإلكترونى').fill(email)
  await page.getByLabel('كلمة المرور').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'الدخول', exact: true }).click()
  await expect(page).toHaveURL(expectedUrl)
  await ready(page)
}
/** Header search box: on small screens the box lives in the collapsed navbar. */
async function headerSearch(page: Page, term: string) {
  const box = page.getByRole('textbox', { name: 'بحث' })
  if (!(await box.isVisible())) await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await box.fill(term)
  await box.press('Enter')
  await expect(page).toHaveURL(/\/search\?search=/)
}
async function addToCartFromBookPage(page: Page, b: { id: number; title: string }) {
  await headerSearch(page, b.title)
  await page.getByRole('link', { name: b.title, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/book/${b.id}(/|$)`))
  await ready(page)
  await page.getByRole('button', { name: 'أضف إلى السلة' }).click()
  await expect(page.getByRole('button', { name: 'في السلة' })).toBeVisible()
}
async function openCartFromHeader(page: Page) {
  await page.locator('a[href="/cart"]:visible').first().click() // icon-only on phones (accessible name is the icon glyph), so match by href
  await expect(page).toHaveURL(/\/cart$/)
  await ready(page)
}
/** Cart -> pledge -> simulator method -> pay; resolves with the payment reference on /checkout/simulate/<ref>. */
async function payWithSimulator(page: Page) {
  const pay = page.getByRole('button', { name: /أدفع الان/ })
  await expect(page.getByRole('radio', { name: /محاكاة الدفع/ })).toBeEnabled()
  await page.getByRole('radio', { name: /محاكاة الدفع/ }).check()
  await expect(pay).toBeEnabled()
  await pay.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('تعهد', { exact: true })).toBeVisible()
  // the pledge gate: confirming without ticking must NOT start the payment
  await dialog.getByRole('button', { name: /لقد فهمت/ }).click()
  await expect(dialog.getByText('من فضلك قم بالموافقة على التعهد أولاً')).toBeVisible()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: /لقد فهمت/ }).click()
  await page.waitForURL(/\/checkout\/simulate\/[0-9a-f-]{36}/)
  await ready(page)
  return page.url().split('/').pop()!
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    // ------------------------------------------------------------------------------------------------ 1. guest
    test.describe('1. guest browsing', () => {
      test('home -> search -> book page: title, price, add-to-cart, locked download tabs', async ({ page }) => {
        const b = paid[0]!
        await open(page, '/')
        await expect(page.locator('.book_block').first()).toBeVisible()
        await noSidewaysScroll(page)

        await headerSearch(page, 'تجريبي') // a word that matches the seeded demo books
        await ready(page)
        await expect(page.locator('.book_block').first()).toBeVisible()
        await expect(page.getByText('لا توجد كتب مطابقة')).toHaveCount(0)
        await noSidewaysScroll(page)

        await headerSearch(page, b.title) // narrow to one known paid book and open it
        await page.getByRole('link', { name: b.title, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/book/${b.id}(/|$)`))
        await ready(page)
        await expect(page.getByRole('heading', { name: b.title, exact: true })).toBeVisible()
        await expect(page.locator('.product_wp .cost').first()).toContainText(b.price.toFixed(2))
        await expect(page.getByRole('button', { name: 'أضف إلى السلة' })).toBeVisible()

        // guest: paid files are locked behind a message, never a link
        await page.getByRole('link', { name: 'الكتاب الإلكتروني' }).click()
        await expect(page.locator('#paid_file')).toBeVisible()
        await expect(page.locator('#paid_file')).toContainText('قم بتسجيل الدخول حتى تستطيع رؤية المحتوى')
        await expect(page.locator('#paid_file a')).toHaveCount(0)
        await page.getByRole('link', { name: 'الكتاب الصوتى' }).click()
        await expect(page.locator('#paid_audio')).toBeVisible()
        await expect(page.locator('#paid_audio')).toContainText('قم بتسجيل الدخول حتى تستطيع رؤية المحتوى')
        await expect(page.locator('#paid_audio a')).toHaveCount(0)
        await noSidewaysScroll(page)
        await shot(page, 'guest-book', vp.name)
      })

      test('books without usable files show "not available" / "being prepared", not a broken control', async ({ page }) => {
        await open(page, `/book/${freeNoFilesId}`)
        await expect(page.getByRole('link', { name: 'الكتاب الإلكتروني' })).toBeVisible()
        await page.getByRole('link', { name: 'الكتاب الإلكتروني' }).click()
        await expect(page.locator('#paid_file')).toContainText('الكتاب الإلكتروني غير متوفر')
        await page.getByRole('link', { name: 'النبذة الإلكترونية' }).click()
        await expect(page.locator('#free_file')).toContainText('لا توجد نبذة إلكترونية الان')
        await expect(page.locator('a[href*="/api/library/download/"]')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'أضف إلى السلة' })).toHaveCount(0) // a free book is not for sale
        await noSidewaysScroll(page)
        await shot(page, 'guest-book-nofiles', vp.name)

        await open(page, `/book/${freePendingId}`)
        await page.getByRole('link', { name: 'الكتاب الإلكتروني' }).click()
        await expect(page.locator('#paid_file')).toContainText('قيد التجهيز')
        await expect(page.locator('#paid_file a')).toHaveCount(0)
        await noSidewaysScroll(page)
      })
    })

    // ------------------------------------------------------------------------------------------------ 2. purchase
    test.describe('2. customer purchase with the development simulator', () => {
      test('login form -> cart -> pledge -> simulator success -> invoice -> library', async ({ page }) => {
        const u = await createTestUser()
        const b = paid[1]!
        await loginViaForm(page, u.email)
        await addToCartFromBookPage(page, b)
        await openCartFromHeader(page)
        await expect(page.getByText(b.title)).toBeVisible()
        await expect(page.locator('#total_cart_item')).toContainText(b.price.toFixed(2))
        await expect(page.getByText('وضع تجريبي: لا يتم أي خصم حقيقي.')).toBeVisible()
        await expect(page.getByRole('radio', { name: /Paymob/ })).toBeDisabled() // unavailable gateways are shown but cannot be chosen
        await noSidewaysScroll(page)
        await shot(page, 'cart', vp.name)

        await payWithSimulator(page)
        await expect(page.getByText('بيئة تجريبية — لا يتم أي دفع حقيقي')).toBeVisible()
        await noSidewaysScroll(page)
        await shot(page, 'simulate', vp.name)
        await page.getByRole('button', { name: /Simulate success/ }).click()

        await page.waitForURL(/\/invoice\/\d+\?purchased=1/)
        await ready(page)
        await expect(page.getByText('تم عملية الشراء بنجاح')).toBeVisible()
        await expect(page.getByText('نجح', { exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: b.title })).toBeVisible()
        await noSidewaysScroll(page)
        await shot(page, 'invoice', vp.name)

        await page.locator('.alert-success').getByRole('link', { name: 'المكتبة' }).click()
        await expect(page).toHaveURL(/\/library$/)
        await ready(page)
        await expect(page.getByText(b.title)).toBeVisible()
        await expect(page.getByText('لا توجد كتب في مكتبتك بعد')).toHaveCount(0)
        await expect(page.locator('#number_product')).toHaveText('') // header cart counter is cleared by the purchase
        await noSidewaysScroll(page)

        // the purchased book left the cart (no stale "already in your library" notice, empty cart)
        await openCartFromHeader(page)
        await expect(page.getByText('عربة التسوق الخاصة بك فارغة')).toBeVisible()
        // and its book page now links to the library instead of offering to buy again
        await open(page, `/book/${b.id}`)
        await expect(page.getByRole('link', { name: 'الكتاب في مكتبتك' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'أضف إلى السلة' })).toHaveCount(0)
      })

      test('simulator failure -> "payment not completed" and the book is NOT in the library', async ({ page }) => {
        const u = await createTestUser()
        const b = paid[2]!
        await loginViaForm(page, u.email)
        await addToCartFromBookPage(page, b)
        await openCartFromHeader(page)
        await payWithSimulator(page)
        await page.getByRole('button', { name: /Simulate failure/ }).click()

        await page.waitForURL(/\/checkout\/return\?reference=/)
        await ready(page)
        await expect(page.getByText('لم تكتمل عملية الدفع')).toBeVisible()
        await expect(page.getByRole('link', { name: 'العودة إلى السلة' })).toBeVisible()
        await noSidewaysScroll(page)
        await shot(page, 'payment-failed', vp.name)

        await page.getByRole('link', { name: 'العودة إلى السلة' }).click()
        await expect(page).toHaveURL(/\/cart$/)
        await ready(page)
        await expect(page.getByText(b.title)).toBeVisible() // still in the cart: nothing was bought

        await open(page, '/library')
        await expect(page.getByText('لا توجد كتب في مكتبتك بعد')).toBeVisible()
        await expect(page.getByText(b.title)).toHaveCount(0)
      })

      test('no available payment method: pay button disabled and the unavailable notice shown', async ({ page }) => {
        await page.route('**/api/checkout/methods', (route) => route.fulfill({ json: { methods: [{ id: 'paymob', label: 'x', available: false }], testMode: false, currency: 'USD' } }))
        await open(page, `/book/${paid[3]!.id}`)
        await page.getByRole('button', { name: 'أضف إلى السلة' }).click()
        await openCartFromHeader(page)
        await expect(page.getByText('الدفع الإلكتروني غير متاح حالياً. لن يتم خصم أي مبلغ.')).toBeVisible()
        await expect(page.getByRole('button', { name: /أدفع الان/ })).toBeDisabled()
        await expect(page.getByText('وضع تجريبي')).toHaveCount(0)
        await noSidewaysScroll(page)
        await shot(page, 'cart-no-methods', vp.name)
      })
    })

    // ------------------------------------------------------------------------------------------------ 3. account pages
    test.describe('3. customer account pages', () => {
      const PAGES: [string, RegExp | string][] = [['/library', 'المكتبة'], ['/favourites', 'قائمة المفضلة'], ['/invoices', /الفواتير \(\d+\)/], ['/update-profile', 'تعديل بياناتى']]
      for (const [path, heading] of PAGES) {
        test(`${path} loads with its heading and no error banner`, async ({ page, context }) => {
          await context.addCookies(await cookiesFor(DEV_USERS.customer))
          await open(page, path)
          await expect(page.getByRole('heading', { name: heading })).toBeVisible()
          await expect(page.locator('.alert-danger')).toHaveCount(0)
          await noSidewaysScroll(page)
          await shot(page, `account${path.replace('/', '-')}`, vp.name)
        })
      }
    })

    // ------------------------------------------------------------------------------------------------ 4. admin
    test.describe('4. admin', () => {
      test('login, books, payments gateway status, recovery, and the draft book lifecycle', async ({ page }) => {
        test.setTimeout(180_000)
        const title = `${TAG} رحلة ${vp.name} ${Date.now().toString(36)}`

        await open(page, '/admin/login')
        await page.getByLabel('البريد الإلكترونى').fill(DEV_USERS.admin)
        await page.getByLabel('كلمة المرور').fill(DEV_PASSWORD)
        await page.getByRole('button', { name: 'الدخول' }).click()
        await expect(page).toHaveURL(/\/admin$/)
        await ready(page)
        await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible()
        await noSidewaysScroll(page)

        await open(page, '/admin/books')
        await expect(page.getByRole('heading', { name: 'الكتب' })).toBeVisible()
        await expect(page.getByRole('table').locator('tbody tr').first()).toBeVisible()
        await expect(page.getByText('لا توجد بيانات')).toHaveCount(0)
        await noSidewaysScroll(page)

        await open(page, '/admin/payments')
        await expect(page.getByText('بوابات الدفع')).toBeVisible()
        for (const gw of [/Paymob/, /Tap/]) {
          const row = page.getByRole('row', { name: gw }).first()
          await expect(row).toBeVisible()
          await expect(row.getByText('NOT VERIFIED')).toBeVisible()
        }
        await noSidewaysScroll(page)
        await shot(page, 'admin-payments', vp.name)

        await open(page, '/admin/recovery')
        await expect(page.getByRole('heading', { name: 'استعادة الكتالوج' })).toBeVisible()
        await expect(page.getByText('لماذا لم تُنشر الكتب؟')).toBeVisible()
        await expect(page.locator('.alert-danger')).toHaveCount(0)
        await noSidewaysScroll(page)

        // create a draft through the BookForm
        await open(page, '/admin/books/create')
        await expect(page.getByRole('heading', { name: 'أضافة كتاب جديد' })).toBeVisible()
        await page.getByLabel('إسم الكتاب').fill(title)
        await page.getByLabel('التكلفة').fill('5')
        await noSidewaysScroll(page)
        await shot(page, 'admin-book-form', vp.name)
        await page.getByRole('button', { name: 'حفظ' }).click()
        await page.waitForURL(/\/admin\/books\/(\d+)\/media/)
        const id = Number(/\/admin\/books\/(\d+)\//.exec(page.url())![1])
        adminCreated.push(id)
        await ready(page)

        // listed under the workflow filter "مسودة"
        await open(page, '/admin/books')
        await page.getByLabel('حالة العمل').selectOption({ label: 'مسودة' })
        await expect(page).toHaveURL(/workflow=draft/)
        await page.getByRole('searchbox', { name: 'بحث' }).fill(title)
        await page.getByRole('searchbox', { name: 'بحث' }).press('Enter')
        const row = page.getByRole('row', { name: new RegExp(title.replace(/[[\]]/g, '\\$&')) })
        await expect(row).toBeVisible()
        await expect(row.getByText('مسودة')).toBeVisible()
        await expect(row.getByText('5.00')).toBeVisible()
        await noSidewaysScroll(page)
        await shot(page, 'admin-books-draft', vp.name)

        // edit the price
        await row.getByRole('button', { name: 'عمليات' }).click()
        await row.getByRole('link', { name: 'تعديل' }).click()
        await expect(page).toHaveURL(new RegExp(`/admin/books/${id}$`))
        await ready(page)
        await expect(page.getByLabel('إسم الكتاب')).toHaveValue(title)
        await page.getByLabel('التكلفة').fill('9')
        await page.getByRole('button', { name: 'حفظ' }).click()
        await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible()
        await open(page, `/admin/books/${id}`)
        await expect(page.getByLabel('التكلفة')).toHaveValue('9')

        // soft delete through the UI
        await open(page, `/admin/books?workflow=draft&q=${encodeURIComponent(title)}`)
        const row2 = page.getByRole('row', { name: new RegExp(title.replace(/[[\]]/g, '\\$&')) })
        await expect(row2.getByText('9.00')).toBeVisible()
        await row2.getByRole('button', { name: 'عمليات' }).click()
        await row2.getByRole('link', { name: 'حذف' }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.locator('input[readonly]')).toHaveValue(title)
        await dialog.getByRole('button', { name: 'حذف', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await expect(page.getByRole('row', { name: new RegExp(title.replace(/[[\]]/g, '\\$&')) })).toHaveCount(0)
        const { data: gone } = await svc.from('books').select('deleted_at').eq('id', id).single()
        expect(gone?.deleted_at, 'soft-deleted, not hard-deleted').not.toBeNull()
        await noSidewaysScroll(page)
      })
    })

    // ------------------------------------------------------------------------------------------------ 5. 404 + protected routes
    test.describe('5. not-found and protected routes', () => {
      test('unknown book shows the Arabic 404 page', async ({ page }) => {
        const resp = await page.goto('/book/99999999', { waitUntil: 'domcontentloaded' })
        expect(resp?.status()).toBe(404)
        await ready(page)
        await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
        await expect(page.getByText('هذه الصفحة غير موجودة')).toBeVisible()
        await expect(page.getByRole('link', { name: 'العودة للرئيسية' })).toBeVisible()
        await noSidewaysScroll(page)
        await shot(page, 'not-found', vp.name)
        await page.getByRole('link', { name: 'العودة للرئيسية' }).click()
        await expect(page).toHaveURL(/\/$/)
        await expect(page.locator('.book_block').first()).toBeVisible()
      })

      test('/admin as a customer redirects away from the admin area', async ({ page, context }) => {
        await context.addCookies(await cookiesFor(DEV_USERS.customer))
        await page.goto('/admin', { waitUntil: 'domcontentloaded' })
        await expect(page).toHaveURL(/localhost:3000\/$/)
        await ready(page)
        await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toHaveCount(0)
      })

      test('/library as a guest redirects to the login form, and logging in returns to /library', async ({ page }) => {
        const u = await createTestUser()
        await page.goto('/library', { waitUntil: 'domcontentloaded' })
        await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)library/)
        await ready(page)
        await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible()
        await noSidewaysScroll(page)
        await page.getByLabel('البريد الإلكترونى').fill(u.email)
        await page.getByLabel('كلمة المرور').fill(DEV_PASSWORD)
        await page.getByRole('button', { name: 'الدخول', exact: true }).click()
        await expect(page).toHaveURL(/\/library$/)
        await ready(page)
        await expect(page.getByRole('heading', { name: 'المكتبة' })).toBeVisible()
      })

      test('/admin as a guest redirects to the login form', async ({ page }) => {
        await page.goto('/admin', { waitUntil: 'domcontentloaded' })
        await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)admin/)
        await ready(page)
        await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible()
      })
    })
  })
}
