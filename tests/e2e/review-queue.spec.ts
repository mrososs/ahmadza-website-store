// The administrator's REVIEW QUEUE for recovered books, in a real browser: a SYNTHETIC evidence-based draft (provenance recovered_media, tagged, removed afterwards;
// real recovered data never touches this stack) appears in the queue with its evidence, cannot be published, is reviewed and priced by the administrator, leaves
// the queue, and can then be published. Runs against the dev server on :3000. Nothing is published unless the administrator does it.
import { test, expect, type Page } from '@playwright/test'
import { anonClient, DEV_PASSWORD, DEV_USERS, serviceClient, sessionCookieHeader } from '../helpers/supabase'

const svc = serviceClient()
const TAG = '[queue-test]'
const TITLE = `${TAG} كتاب مسودة للمراجعة`
let bookId = 0
const staged: string[] = []

test.beforeAll(async () => {
  const sha = 'e'.repeat(64)
  const legacyPath = 'storage/app/public/product_media/queue-test-original-name-1700000001.pdf'
  const evidence = {
    source: 'pdf_metadata', sha256: sha, byte_size: 1234, pdf: { title: TITLE, author: 'اسم من بيانات الملف', pages: 42, created: null },
    source_file: { legacy_path: legacyPath, original_name: 'queue-test-original-name-1700000001.pdf', duplicate_paths: [] },
    checks: { hash_verified: true, size_verified: true, active_content: 'none found', encrypted: false, malware_scan: 'clean', scanned_at: new Date().toISOString() },
    uncertain: { price: 'unknown' }, note: 'price and original record unknown; admin review required',
  }
  bookId = (await svc.from('books').insert({ title: TITLE, kind: 'paid', status: 'draft', price_amount: 0, provenance: 'recovered_media', recovery_evidence: evidence, is_demo: true } as never).select('id').single()).data!.id
  const media = (await svc.from('book_media').insert({ book_id: bookId, name: TITLE, visibility: 'after_purchase', storage_path: `books/${bookId}/queue-test.pdf`, sha256: sha, byte_size: 1234, legacy_path: legacyPath } as never).select('id').single()).data!
  staged.push(legacyPath)
  await svc.from('legacy_media_staging').insert({ legacy_path: legacyPath, sha256: sha, byte_size: 1234, detected_type: 'pdf', status: 'staged', scope: 'product', scanned_at: new Date().toISOString(), av_result: 'clean', book_media_id: media.id } as never)
})
test.afterAll(async () => {
  await svc.from('legacy_media_staging').delete().in('legacy_path', staged)
  await svc.from('books').delete().like('title', `${TAG}%`)
})

async function adminCookies() {
  const { data, error } = await anonClient().auth.signInWithPassword({ email: DEV_USERS.admin, password: DEV_PASSWORD })
  if (error || !data.session) throw new Error(error?.message)
  return sessionCookieHeader(data.session).split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' } })
}
async function ready(page: Page) {
  await page.waitForFunction(() => (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp?.().isHydrating === false, null, { timeout: 20_000 })
  await expect(page.locator('.fa-spin')).toHaveCount(0, { timeout: 15_000 })
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)

for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
  test.describe(`viewport ${vp.n}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } })
    test.beforeEach(async ({ context }) => {
      await context.addCookies(await adminCookies())
      await svc.from('books').update({ status: 'draft', price_amount: 0, legacy_verified_at: null, legacy_verified_by: null } as never).eq('id', bookId)
    })

    test('the draft is in the queue with its evidence and what is missing; publishing is refused with reasons; review plus a price makes it publishable', async ({ page }) => {
      await page.goto('/admin/recovery', { waitUntil: 'domcontentloaded' })
      await ready(page)
      const row = page.locator('#review-queue tr', { hasText: TITLE })
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(row).toContainText('queue-test-original-name-1700000001.pdf') // the original file name is preserved and shown
      await expect(row).toContainText('غير موثق') // the author in the file is labelled unverified
      await expect(row).toContainText('السعر الأصلي مفقود')
      await expect(row).toContainText('المصدر لم يُعتمد')
      expect(await noSideScroll(page)).toBe(true)
      await page.screenshot({ path: `test-results/review-queue/queue-${vp.n}.png`, fullPage: true })

      await row.getByRole('link', { name: 'مراجعة', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/admin/books/${bookId}$`))
      await ready(page)
      await expect(page.getByText('بيانات الاستعادة')).toBeVisible()
      await expect(page.getByText('العنوان في الملف الأصلي')).toBeVisible()
      await expect(page.getByText('لا يمكن نشر هذا الكتاب بعد:')).toBeVisible()
      expect(await noSideScroll(page)).toBe(true)

      // the server (not the button) refuses: publishing straight through the admin API says exactly why
      const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
      const body = { title: TITLE, kind: 'paid', status: 'published', price_amount: 9, pages: 42, category_ids: [], maker_ids: [], tags: [], related_ids: [] }
      const refused = await fetch(`http://localhost:3000/api/admin/books/${bookId}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(refused.status).toBe(409)
      expect((await refused.json()).data.reasons).toContain('source_not_verified')

      // the administrator reviews it (confirm dialog) and sets a real price in the form, saved as a draft
      page.once('dialog', (d) => d.accept())
      await page.getByRole('button', { name: 'اعتماد هذا الكتاب بعد مراجعته' }).click()
      await expect(page.getByText(/تم الاعتماد/)).toBeVisible({ timeout: 10_000 })
      await page.locator('#b-cost').fill('9')
      await page.getByRole('button', { name: 'حفظ' }).click()
      await expect(page.getByText('تم الحفظ بنجاح')).toBeVisible({ timeout: 10_000 })

      // nothing was published by reviewing, and it has left the queue
      expect((await svc.from('books').select('status').eq('id', bookId).single()).data?.status).toBe('draft')
      await page.goto('/admin/recovery', { waitUntil: 'domcontentloaded' })
      await ready(page)
      await expect(page.locator('#review-queue')).toBeVisible()
      await expect(page.locator('#review-queue tr', { hasText: TITLE })).toHaveCount(0)
      await page.screenshot({ path: `test-results/review-queue/after-review-${vp.n}.png`, fullPage: true })

      // only now can it be published, by the administrator
      const ok = await fetch(`http://localhost:3000/api/admin/books/${bookId}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(ok.status).toBeLessThan(300)
      expect((await svc.from('books').select('status,legacy_verified_at').eq('id', bookId).single()).data).toMatchObject({ status: 'published' })
    })
  })
}
