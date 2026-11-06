// The administrator second-factor step in the REAL browser: an admin with an enrolled authenticator app must enter the 6-digit code at login.
// (Server enforcement is covered by tests/api/admin-mfa.test.ts; this proves the screens work.) Runs against the dev server on :3000; the factor
// it enrols is removed afterwards so the seeded admin is left exactly as found.
import { test, expect } from '@playwright/test'
import { DEV_PASSWORD, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'
import { totp } from '../helpers/totp'

const svc = serviceClient()
let secret = ''

async function removeFactors() {
  const { userId } = await signedInClient(DEV_USERS.admin)
  const { data } = await svc.auth.admin.mfa.listFactors({ userId })
  for (const f of data?.factors ?? []) await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId })
}

test.beforeAll(async () => {
  await removeFactors()
  const { client } = await signedInClient(DEV_USERS.admin)
  const e = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ui-test' })
  secret = e.data!.totp.secret
  const v = await client.auth.mfa.challengeAndVerify({ factorId: e.data!.id, code: totp(secret) })
  if (v.error) throw new Error(v.error.message)
})
test.afterAll(removeFactors)

for (const vp of [{ n: '1440', w: 1440, h: 900 }, { n: '390', w: 390, h: 844 }]) {
  test.describe(`viewport ${vp.n}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } })

    test('password first, then the code: a wrong code is refused, the right one opens the dashboard', async ({ page }) => {
      await page.goto('/admin/login', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => (window as unknown as { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp?.().isHydrating === false, null, { timeout: 15_000 }).catch(() => {})
      await page.locator('#admin-email').fill(DEV_USERS.admin)
      await page.locator('#admin-password').fill(DEV_PASSWORD)
      await page.getByRole('button', { name: 'الدخول' }).click()

      const code = page.getByLabel('رمز التحقق')
      await expect(code).toBeVisible({ timeout: 15_000 })
      await expect(page).toHaveURL(/\/admin\/login/) // not signed in to the dashboard yet
      await code.fill('abc')
      await page.getByRole('button', { name: 'تحقق' }).click()
      await expect(page.getByText('أدخل الرمز المكوّن من 6 أرقام').first()).toBeVisible() // the client-side check, with the correct pattern

      await code.fill('000000')
      await page.getByRole('button', { name: 'تحقق' }).click()
      await expect(page.getByText('الرمز غير صحيح أو منتهي')).toBeVisible()

      // the code of the NEXT 30-second step: the one used to enrol the factor is already spent
      await code.fill(totp(secret, Date.now() + 30_000))
      await page.getByRole('button', { name: 'تحقق' }).click()
      await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    })
  })
}
