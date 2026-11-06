// Responsive regression for the partial-catalogue recovery UI (admin dashboard, list badge/filter, book recovery panel) at 1440 / 768 / 390.
// Run against the local dev server:  npx playwright test -c tests/e2e/playwright.config.ts recovery-ui
// Fixtures are tagged recovered books on the LOCAL dev database; they are removed afterwards. Screenshots go to test-results/ (not committed).
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { anonClient, DEV_PASSWORD, serviceClient, sessionCookieHeader } from '../helpers/supabase'

const VIEWPORTS = [{ name: '1440', width: 1440, height: 900 }, { name: '768', width: 768, height: 1024 }, { name: '390', width: 390, height: 844 }] as const
const SHOTS = new URL('../../test-results/recovery-ui/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const TAG = '[recovery-ui-test] '
const svc = serviceClient()
let runId = 0
let blockedId = 0
let storefrontId = 0
const staged: string[] = []

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true })
  runId = (await svc.from('migration_runs').insert({ kind: 'recovery-ui-test', dry_run: false }).select('id').single()).data!.id
  const base = { kind: 'paid', status: 'draft', price_amount: 0, provenance: 'legacy', is_demo: true, import_run_id: runId }
  blockedId = (await svc.from('books').insert({ ...base, title: `${TAG}كتاب مستعاد غير مكتمل بعنوان طويل جداً لاختبار التفاف النص في الجداول والبطاقات`, legacy_id: 930001, legacy_status_raw: '1', legacy_cost_raw: 'abc' } as never).select('id').single()).data!.id
  const readyId = (await svc.from('books').insert({ ...base, title: `${TAG}كتاب جاهز`, price_amount: 7, legacy_cost_raw: '7', legacy_id: 930002, legacy_status_raw: '1', legacy_verified_at: new Date().toISOString() } as never).select('id').single()).data!.id
  // storefront fixture: a PUBLISHED book whose recorded cover file does not exist in storage and whose only preview file is still pending
  storefrontId = (await svc.from('books').insert({ title: `${TAG}storefront`, kind: 'free', status: 'published', price_amount: 0, is_demo: true, cover_path: 'books/zzz-recovery-ui-missing-cover.webp' } as never).select('id').single()).data!.id
  await svc.from('book_media').insert({ book_id: storefrontId, name: `${TAG}preview`, visibility: 'preview', migration_status: 'pending', storage_path: null } as never)
  const path = 'storage/app/public/product_media/recovery-ui-test.pdf'
  staged.push(path)
  const m = (await svc.from('book_media').insert({ book_id: readyId, name: `${TAG}file`, visibility: 'after_purchase', storage_path: `books/${readyId}/recovery-ui-test.pdf`, sha256: 'd'.repeat(64), byte_size: 10, legacy_book_media_id: 930002, legacy_path: path } as never).select('id').single()).data!.id
  await svc.from('legacy_media_staging').insert({ legacy_path: path, sha256: 'd'.repeat(64), byte_size: 10, detected_type: 'pdf', status: 'staged', scope: 'product', scanned_at: new Date().toISOString(), av_result: 'clean', book_media_id: m } as never)
})
test.afterAll(async () => {
  await svc.from('legacy_media_staging').delete().in('legacy_path', staged)
  await svc.from('books').delete().like('title', `${TAG}%`)
  await svc.from('migration_runs').delete().eq('id', runId)
})

async function adminCookies() {
  const { data, error } = await anonClient().auth.signInWithPassword({ email: 'admin@aawraq.test', password: DEV_PASSWORD })
  if (error || !data.session) throw new Error(error?.message)
  return sessionCookieHeader(data.session).split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' } })
}
async function settle(page: Page) {
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForFunction(() => !document.querySelector('.fa-spin'), null, { timeout: 10_000 }).catch(() => {})
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' })
  await page.waitForTimeout(500)
}
/** The admin theme keeps the sidebar fixed; what matters is that the CONTENT never forces a sideways scroll of the page. */
const hasHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })
    test.beforeEach(async ({ context }) => { await context.addCookies(await adminCookies()) })

    test('recovery dashboard renders summary, blockers and runs without sideways scroll', async ({ page }) => {
      await page.goto('/admin/recovery', { waitUntil: 'domcontentloaded' })
      await settle(page)
      await expect(page.getByText('كتب مستعادة')).toBeVisible()
      await expect(page.getByText('لماذا لم تُنشر الكتب؟')).toBeVisible()
      await expect(page.getByText('عمليات الاستيراد')).toBeVisible()
      await expect(page.getByText('السجلات المرفوضة', { exact: false })).toBeVisible()
      expect(await hasHorizontalScroll(page)).toBe(false)
      await page.screenshot({ path: `${SHOTS}dashboard-${vp.name}.png`, fullPage: true })
    })

    test('verify dialog blocks confirmation until the exact phrase is typed', async ({ page }) => {
      await page.goto('/admin/recovery', { waitUntil: 'domcontentloaded' })
      await settle(page)
      await page.getByRole('button', { name: 'اعتماد المصدر' }).first().click()
      const confirm = page.getByRole('dialog').getByRole('button', { name: 'تأكيد' })
      await expect(confirm).toBeDisabled()
      await page.getByLabel('اكتب العبارة التالية للتأكيد:').fill('خطأ')
      await expect(confirm).toBeDisabled()
      await page.screenshot({ path: `${SHOTS}verify-dialog-${vp.name}.png` })
    })

    test('books list shows readiness badges and the recovery filter narrows to recovered books', async ({ page }) => {
      await page.goto(`/admin/books?recovery=not_ready&q=${encodeURIComponent(TAG)}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      await expect(page.getByText(/ناقص \(\d+\)/).first()).toBeVisible()
      await expect(page.getByText('بلا ملف موثق').first()).toBeVisible()
      expect(await hasHorizontalScroll(page)).toBe(false)
      await page.screenshot({ path: `${SHOTS}books-list-${vp.name}.png`, fullPage: true })
    })

    test('storefront: a missing cover file falls back to the default cover and a pending file says it is being prepared', async ({ page }) => {
      await page.goto(`/book/${storefrontId}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      const cover = page.locator('.product_img img')
      await expect(cover).toHaveAttribute('src', /default-cover.webp$/)
      await expect.poll(() => cover.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0) // really rendered, not a broken image
      expect(await page.locator('#free_file').textContent()).toContain('قيد التجهيز')
      expect(await hasHorizontalScroll(page)).toBe(false)
      await page.screenshot({ path: `${SHOTS}storefront-book-${vp.name}.png`, fullPage: true })
    })

    test('a recovered draft shows its panel: original raw price, reasons in Arabic, no publish path', async ({ page }) => {
      await page.goto(`/admin/books/${blockedId}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      await expect(page.getByText('بيانات الاستعادة')).toBeVisible()
      await expect(page.getByText('abc')).toBeVisible() // the original raw price string is preserved and shown
      await expect(page.getByText('لا يمكن نشر هذا الكتاب بعد:')).toBeVisible()
      await expect(page.getByText('السعر الأصلي غير صالح أو صفر')).toBeVisible()
      await expect(page.getByText('لا يوجد ملف مرتبط تم التحقق منه')).toBeVisible()
      expect(await hasHorizontalScroll(page)).toBe(false)
      await page.screenshot({ path: `${SHOTS}book-panel-${vp.name}.png`, fullPage: true })
    })
  })
}
