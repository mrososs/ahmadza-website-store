// UI refinement checks: captures the storefront at 1440 / 1024 / 768 / 390 / 360 px, asserts the specific defects the
// refinement pass targets (card geometry, badge placement, touch targets, overflow) and stores screenshots under
// docs/implementation/ui-refinement/after/.
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { anonClient, DEV_PASSWORD, sessionCookieHeader } from '../helpers/supabase'

const OUT = new URL('../../docs/implementation/ui-refinement/after/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const VPS = [{ n: 1440, h: 900 }, { n: 1024, h: 768 }, { n: 768, h: 1024 }, { n: 390, h: 844 }, { n: 360, h: 740 }]
const PAGES: { name: string; path: string; auth?: string }[] = [
  { name: 'home', path: '/' }, { name: 'search', path: '/search?search=%D9%83%D8%AA%D8%A7%D8%A8' },
  { name: 'categories', path: '/categories' }, { name: 'authors', path: '/authors' }, { name: 'book-details', path: '/book/2' },
  { name: 'cart', path: '/cart' }, { name: 'login', path: '/login' }, { name: 'register', path: '/register' },
  { name: 'library', path: '/library', auth: 'customer@aawraq.test' },
  { name: 'affiliate-dashboard', path: '/affiliate', auth: 'affiliate@aawraq.test' },
  { name: 'admin-dashboard', path: '/admin', auth: 'admin@aawraq.test' },
]
const results: Record<string, unknown>[] = []
test.afterAll(() => { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2)) })

async function cookies(email: string) {
  const { data } = await anonClient().auth.signInWithPassword({ email, password: DEV_PASSWORD })
  return sessionCookieHeader(data.session!).split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' } })
}
async function settle(page: Page) {
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForFunction(() => !document.querySelector('.fa-spin'), null, { timeout: 8000 }).catch(() => {})
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' })
  await page.waitForTimeout(600)
}

for (const vp of VPS) {
  for (const p of PAGES) {
    test(`${p.name} @ ${vp.n}`, async ({ browser }) => {
      mkdirSync(OUT, { recursive: true })
      const ctx = await browser.newContext({ viewport: { width: vp.n, height: vp.h }, locale: 'ar' })
      if (p.auth) await ctx.addCookies(await cookies(p.auth))
      const page = await ctx.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      const resp = await page.goto(`http://localhost:3000${p.path}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      const dir = await page.evaluate(() => document.documentElement.dir)
      await page.screenshot({ path: `${OUT}${p.name}-${vp.n}.png`, fullPage: true })

      const metrics: Record<string, unknown> = {}
      if (p.name === 'home' || p.name === 'search') {
        const m = await page.evaluate(() => {
          const cards = [...document.querySelectorAll<HTMLElement>('.wp_home .book_block')]
          const rect = (e: Element) => e.getBoundingClientRect()
          const rows = new Map<number, number[]>()
          let badgeOutside = 0, tinyTargets = 0, distorted = 0, titleClipped = 0
          for (const c of cards) {
            const r = rect(c); const k = Math.round(r.top)
            rows.set(k, [...(rows.get(k) ?? []), Math.round(r.height)])
            const b = c.querySelector('.type_book'); if (b) { const br = rect(b); if (br.left < r.left || br.right > r.right || br.top < r.top) badgeOutside++ }
            const btn = c.querySelector('.under .cart'); if (btn) { const bb = rect(btn); if (bb.width < 40 || bb.height < 36) tinyTargets++ }
            const img = c.querySelector<HTMLImageElement>('.img-block img'); if (img && img.naturalWidth) {
              const cs = getComputedStyle(img); const brandMark = img.src.endsWith('default-cover.webp'); if (cs.objectFit !== 'contain' && !brandMark) distorted++
            }
            const t = c.querySelector<HTMLElement>('.info .name'); if (t && t.scrollHeight > t.clientHeight + 2 && getComputedStyle(t).webkitLineClamp === 'none') titleClipped++
          }
          const unevenRows = [...rows.values()].filter((hs) => new Set(hs).size > 1).length
          const first = cards[0] ? rect(cards[0]) : null
          return { cards: cards.length, columns: new Set(cards.map((c) => Math.round(rect(c).left))).size, cardW: first ? Math.round(first.width) : 0, cardH: first ? Math.round(first.height) : 0, unevenRows, badgeOutside, tinyTargets, distorted, titleClipped }
        })
        Object.assign(metrics, m)
      }
      results.push({ page: p.name, viewport: vp.n, status: resp?.status(), dir, overflowPx: overflow, ...metrics, pageErrors: errors })
      await ctx.close()

      expect(resp?.status()).toBeLessThan(400)
      expect(dir).toBe('rtl')
      expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1)
      expect(errors).toEqual([])
      if (metrics.cards) {
        expect(metrics.unevenRows, 'cards in a row share one height').toBe(0)
        expect(metrics.badgeOutside, 'badges stay inside card bounds').toBe(0)
        expect(metrics.tinyTargets, 'cart buttons are touch-sized').toBe(0)
        expect(metrics.distorted, 'covers use object-fit: contain').toBe(0)
      }
    })
  }
}
