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

// ---- covers: filters, provenance, duplicate warning, and the administrator's decisions -----------------------------------------------------------------------------
// The ids come from the runner (which snapshots and restores the two decision books); without them these tests skip. Approving or rejecting changes only the cover record.
const DUP = Number(process.env.COVER_TEST_DUP ?? 0)
const APPROVE = Number(process.env.COVER_TEST_APPROVE ?? 0)
const REJECT = Number(process.env.COVER_TEST_REJECT ?? 0)

test.describe('covers in the admin (genuine drafts)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  const total = async (page: Page, query: string) => (await (await page.request.get(`${ORIGIN}/api/admin/books?${query}`)).json()).total as number

  test('the cover and gap filters partition the drafts and nothing is mislabelled', async ({ page }) => {
    await login(page)
    const all = await total(page, 'status=inactive')
    const none = await total(page, 'status=inactive&cover=none'), generated = await total(page, 'status=inactive&cover=generated'), original = await total(page, 'status=inactive&cover=original')
    expect(none + generated + original, 'every book either has no cover or a cover of a known provenance').toBe(all)
    expect(original, 'no original cover has been recovered, so none may be claimed').toBe(0)
    expect(await total(page, 'status=inactive&cover=candidate')).toBeGreaterThan(0)
    expect(await total(page, 'status=inactive&gap=price'), 'every genuine draft has an unknown price').toBe(all)
    expect(await total(page, 'status=inactive&gap=author'), 'no author is known for any of them').toBe(all)
    // a filter combines with the workflow filter and with the search box
    expect(await total(page, 'status=inactive&cover=none&workflow=needs_review')).toBeLessThanOrEqual(none)
    expect(await total(page, `status=inactive&cover=generated&q=${encodeURIComponent('zzzz-nothing')}`)).toBe(0)
    // malformed values are refused, not turned into a query
    expect((await page.request.get(`${ORIGIN}/api/admin/books?cover=drop%20table`)).status()).toBe(400)
  })

  test('the books list offers the filters and badges the covers by provenance', async ({ page }) => {
    await login(page)
    await page.goto(`${ORIGIN}/admin/books?status=inactive`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#cover-filter')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#gap-filter')).toBeVisible()
    await expect(page.locator('table tbody tr td').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('غلاف مُولَّد من الملف').first()).toBeVisible()
    await page.locator('#cover-filter').selectOption('none')
    await page.waitForURL(/cover=none/)
    await expect(page.locator('table tbody tr td').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('غلاف مُولَّد من الملف')).toHaveCount(0) // no row without a cover claims a generated one
  })

  test('a book with a generated cover shows it, says it is not the original, and warns about same-title books', async ({ page }) => {
    test.skip(!DUP, 'needs COVER_TEST_DUP')
    await login(page)
    await page.goto(`${ORIGIN}/admin/books/${DUP}`, { waitUntil: 'domcontentloaded' })
    const block = page.getByTestId('cover-block')
    await expect(block).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('duplicate-warning')).toContainText('بنفس العنوان')
    await expect(page.getByTestId('duplicate-warning')).toContainText('لا يُدمج')
    await expect(page.getByTestId('evidence-support')).toContainText('بلا أي دليل')
    const current = page.getByTestId('cover-current')
    if (await current.count()) {
      await expect(block).toContainText('وليست الغلاف الأصلي')
      await expect.poll(() => current.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
    }
    if (process.env.ADMIN_SHOT_DIR) await page.locator('.recovery-panel').screenshot({ path: `${process.env.ADMIN_SHOT_DIR}/admin-panel-dup.png` })
  })

  test('approving a candidate sets the cover and nothing else; a decided candidate cannot be decided again', async ({ page }) => {
    test.skip(!APPROVE, 'needs COVER_TEST_APPROVE')
    page.on('dialog', (d) => d.accept())
    await login(page)
    await page.goto(`${ORIGIN}/admin/books/${APPROVE}`, { waitUntil: 'domcontentloaded' })
    const cand = page.locator('[data-testid^="cover-candidate-"]').first()
    await expect(cand).toBeVisible({ timeout: 30_000 })
    await expect(cand.locator('img')).toBeVisible()
    if (process.env.ADMIN_SHOT_DIR) await page.locator('.recovery-panel').screenshot({ path: `${process.env.ADMIN_SHOT_DIR}/admin-panel-candidate.png` })
    const before = await (await page.request.get(`${ORIGIN}/api/admin/books/${APPROVE}`)).json()
    expect(before.cover_path).toBeNull()
    const candId = ((await cand.getAttribute('data-testid')) ?? '').replace('cover-candidate-', '')
    await cand.getByRole('button', { name: 'اعتماد كغلاف' }).click()
    await expect(page.getByTestId('cover-current')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('cover-block')).toContainText('اعتمدها مسؤول')
    const after = await (await page.request.get(`${ORIGIN}/api/admin/books/${APPROVE}`)).json()
    expect(after.cover_path).toMatch(/^books\/\d+\/[0-9a-f]{12}\.jpg$/)
    expect(after.status, 'a cover never publishes a book').toBe(before.status)
    expect(Number(after.price_amount), 'a cover never sets a price').toBe(Number(before.price_amount))
    expect(after.recovery_evidence.cover.current.review).toBe('approved_by_admin')
    expect(after.recovery_evidence.cover.has_pending).toBe(false)
    const again = await page.request.post(`${ORIGIN}/api/admin/books/${APPROVE}/cover-candidate`, { data: { candidate: candId, decision: 'approve' } })
    expect(again.status(), 'an already decided candidate is refused').toBe(400)
    const bogus = await page.request.post(`${ORIGIN}/api/admin/books/${APPROVE}/cover-candidate`, { data: { candidate: 'zzzz', decision: 'approve' } })
    expect(bogus.status()).toBe(400)
  })

  test('rejecting a candidate leaves the book without that cover', async ({ page }) => {
    test.skip(!REJECT, 'needs COVER_TEST_REJECT')
    page.on('dialog', (d) => d.accept())
    await login(page)
    await page.goto(`${ORIGIN}/admin/books/${REJECT}`, { waitUntil: 'domcontentloaded' })
    const cand = page.locator('[data-testid^="cover-candidate-"]').first()
    await expect(cand).toBeVisible({ timeout: 30_000 })
    await cand.getByRole('button', { name: 'رفض', exact: true }).click()
    await expect(cand).toContainText('مرفوض', { timeout: 30_000 })
    const after = await (await page.request.get(`${ORIGIN}/api/admin/books/${REJECT}`)).json()
    expect(after.cover_path).toBeNull()
    expect(after.recovery_evidence.cover.candidates[0].status).toBe('rejected')
  })
})
