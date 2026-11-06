// Hydration guard: every storefront / account page must hydrate with NO server/client mismatch warnings.
// Run against the local dev server (TEST_APP_URL, default http://localhost:3000):  npx playwright test -c tests/e2e/playwright.config.ts hydration
// Background: with payload extraction on, a page's HTML and its `_payload.json` were separate responses, so catalogue changes between
// them produced mismatches (measured 39/40 loads while data changed). nuxt.config.ts keeps payloads inline; this spec protects that.
import { test, expect } from '@playwright/test'
import { anonClient, DEV_PASSWORD, sessionCookieHeader } from '../helpers/supabase'

const PUBLIC = ['/', '/search', '/search?search=%D9%83%D8%AA%D8%A7%D8%A8', '/categories', '/authors', '/articles', '/book/2', '/cart', '/login', '/register', '/forgot-password', '/contact']
const ACCOUNT: [string, string][] = [['/library', 'customer@aawraq.test'], ['/favourites', 'customer@aawraq.test'], ['/invoices', 'customer@aawraq.test'], ['/affiliate', 'affiliate@aawraq.test']]

async function cookiesFor(email: string) {
  const { data } = await anonClient().auth.signInWithPassword({ email, password: DEV_PASSWORD })
  return sessionCookieHeader(data.session!).split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' } })
}

async function hydrationWarnings(page: import('@playwright/test').Page, path: string) {
  // Warm-up visit: the FIRST request of a route after a dev-server (re)start makes Vite optimise dependencies and reload the
  // page, which logs spurious mismatches. That is dev-server cold start, not an application defect; the measured load follows.
  await page.goto(path, { waitUntil: 'networkidle' })
  const msgs: string[] = []
  page.on('console', (m) => { if (/hydrat/i.test(m.text())) msgs.push(m.text().split('\n')[0]!.slice(0, 160)) })
  await page.goto(path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(200)
  return msgs
}

for (const path of PUBLIC) {
  test(`public ${path} hydrates cleanly`, async ({ page }) => {
    expect(await hydrationWarnings(page, path)).toEqual([])
  })
}
for (const [path, who] of ACCOUNT) {
  test(`account ${path} (${who.split('@')[0]}) hydrates cleanly`, async ({ page, context }) => {
    await context.addCookies(await cookiesFor(who))
    expect(await hydrationWarnings(page, path)).toEqual([])
  })
}
