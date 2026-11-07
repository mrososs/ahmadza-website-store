// The administrator's review screens against GENUINE recovered drafts (not fixtures), in a real browser. READ-ONLY: it opens, reads and types into a field without saving.
// It never clicks approve, reject or save, so no record changes.
//   ADMIN_REVIEW_ORIGIN=http://localhost:3100 ADMIN_REVIEW_EMAIL=<admin> ADMIN_REVIEW_PASSWORD=<password> npx playwright test -c tests/e2e/playwright.config.ts admin-real-data
// Skipped when the variables are not set. Point it at a stack that holds the recovered drafts (the isolated recovery stack, or hosted once an administrator exists).
import { test, expect, type Page } from '@playwright/test'

const ORIGIN = (process.env.ADMIN_REVIEW_ORIGIN ?? '').replace(/\/+$/, '')
const EMAIL = process.env.ADMIN_REVIEW_EMAIL ?? ''
const PASSWORD = process.env.ADMIN_REVIEW_PASSWORD ?? ''
test.skip(!ORIGIN || !EMAIL || !PASSWORD, 'set ADMIN_REVIEW_ORIGIN, ADMIN_REVIEW_EMAIL and ADMIN_REVIEW_PASSWORD to run the real-data admin review test')

const VIEWPORTS = [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }] as const
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function login(page: Page) {
  await page.goto(`${ORIGIN}/admin/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('البريد الإلكترونى').fill(EMAIL)
  await page.getByLabel('كلمة المرور').fill(PASSWORD)
  await page.getByRole('button', { name: /الدخول/ }).click()
  await page.waitForURL(/\/admin\/?(\?.*)?$/, { timeout: 30_000 })
}

for (const vp of VIEWPORTS) {
  test.describe(`admin review of genuine recovered drafts, viewport ${vp.n}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } })

    test('the review queue and the books list hold the recovered drafts', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)))
      await login(page)
      await page.goto(`${ORIGIN}/admin/recovery`, { waitUntil: 'domcontentloaded' })
      const queue = page.locator('#review-queue')
      await expect(queue).toBeVisible({ timeout: 30_000 })
      await expect(queue.locator('a[href^="/admin/books/"]').first()).toBeVisible({ timeout: 30_000 })
      expect(await queue.locator('a[href^="/admin/books/"]').count()).toBeGreaterThan(0)
      expect(await overflow(page)).toBeLessThanOrEqual(1)

      await page.goto(`${ORIGIN}/admin/books?workflow=needs_review`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('table tbody tr td').first()).toBeVisible({ timeout: 30_000 })
      expect(await page.locator('table tbody tr').count()).toBeGreaterThan(0)
      await expect(page.locator('.alert-danger')).toHaveCount(0)
      expect(await page.locator('body').innerText()).not.toMatch(/\b(undefined|NaN|\[object Object\])\b/)
      expect(errors).toEqual([])
    })

    test('a recovered book shows its original evidence and what is still unknown, and offers approve, reject, edit and cover upload', async ({ page }) => {
      await login(page)
      await page.goto(`${ORIGIN}/admin/recovery`, { waitUntil: 'domcontentloaded' })
      const first = page.locator('#review-queue a[href^="/admin/books/"]').first()
      await expect(first).toBeVisible({ timeout: 30_000 })
      const href = await first.getAttribute('href')
      await page.goto(`${ORIGIN}${href}`, { waitUntil: 'domcontentloaded' })

      const panel = page.locator('.recovery-panel')
      await expect(panel).toBeVisible({ timeout: 30_000 })
      await expect(panel).toContainText('بيانات الاستعادة')
      await expect(panel).toContainText('غير جاهز للنشر') // a genuine draft is never ready: no price, no verified file
      // the evidence: original file name and path, size, fingerprint, scan result
      await expect(panel.getByTestId('evidence-original-name')).toContainText(/\.pdf$/i)
      await expect(panel).toContainText('المسار الأصلي')
      await expect(panel).toContainText('بصمة الملف')
      await expect(panel).toContainText('فحص الملف عند الاستعادة')
      // what was never established is said, not guessed
      const unknowns = panel.getByTestId('evidence-unknowns')
      await expect(unknowns).toContainText('السعر مجهول')
      await expect(unknowns).toContainText('المؤلف غير مُسند')
      await expect(unknowns).toContainText('الأقسام غير محددة')
      await expect(panel).toContainText('لا يمكن نشر هذا الكتاب بعد')

      // the reviewer's actions are all there
      await expect(page.getByRole('button', { name: 'اعتماد هذا الكتاب بعد مراجعته' })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'رفض هذا السجل' })).toBeEnabled()
      expect(await page.locator('input[type="file"]').count(), 'a cover can be uploaded').toBeGreaterThan(0)
            // title, price and author can be edited (typed here, never saved)
      await expect(page.locator('#b-title')).toBeEditable()
      await expect(page.locator('#b-title')).not.toHaveValue('')
      await expect(page.locator('#b-cost')).toBeEditable()
      await expect(page.locator('#b-cost')).toHaveValue('0') // the placeholder: nobody has set a price
      expect(await overflow(page)).toBeLessThanOrEqual(1)

      // the media manager (where a missing file is resolved by an upload or an external link) opens for this book
      await page.goto(`${ORIGIN}${href}/media`, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('h1.name')).toBeVisible({ timeout: 30_000 })
      expect(await page.locator('input[type="file"]').count(), 'a file can be uploaded for this book').toBeGreaterThan(0)
      await expect(page.locator('.alert-danger')).toHaveCount(0)
    })
  })
}
