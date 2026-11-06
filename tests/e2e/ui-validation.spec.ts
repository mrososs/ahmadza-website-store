// Visual validation: screenshots the NEW app and the static legacy UI reference (ui-reference, served on :4173 by
// `node ../ui-reference/serve.mjs 4173`) at 1440 / 768 / 390 and writes docs/implementation/ui-validation/.
// The reference is a reconstruction from the Blade source — NOT screenshots of the original production site — so the
// diff percentage is a regression signal, not proof of a 1:1 match (see docs/implementation/05-legacy-ui-fidelity.md).
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { anonClient, DEV_PASSWORD, sessionCookieHeader } from '../helpers/supabase'

const REF = process.env.REF_URL ?? 'http://127.0.0.1:4173'
const OUT = new URL('../../docs/implementation/ui-validation/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
] as const

interface Shot { name: string; path: string; ref: string; auth?: string; admin?: boolean }
const SHOTS: Shot[] = [
  { name: 'home', path: '/', ref: '/pages/storefront/home.html' },
  { name: 'search', path: '/search?search=%D9%83%D8%AA%D8%A7%D8%A8', ref: '/pages/storefront/search.html' },
  { name: 'book-details', path: '/book/2', ref: '/pages/storefront/book.html' },
  { name: 'categories', path: '/categories', ref: '/pages/storefront/categories.html' },
  { name: 'authors', path: '/authors', ref: '/pages/storefront/authors.html' },
  { name: 'articles', path: '/articles', ref: '/pages/storefront/articles.html' },
  { name: 'contact', path: '/contact', ref: '/pages/storefront/contact.html' },
  { name: 'cart', path: '/cart', ref: '/pages/storefront/cart.html' },
  { name: 'login', path: '/login', ref: '/pages/storefront/login.html' },
  { name: 'register', path: '/register', ref: '/pages/storefront/register.html' },
  { name: 'library', path: '/library', ref: '/pages/customer/library.html', auth: 'customer@aawraq.test' },
  { name: 'invoices', path: '/invoices', ref: '/pages/customer/invoices.html', auth: 'customer@aawraq.test' },
  { name: 'affiliate-dashboard', path: '/affiliate', ref: '/pages/affiliate/dashboard.html', auth: 'affiliate@aawraq.test' },
  { name: 'admin-dashboard', path: '/admin', ref: '/pages/admin/dashboard.html', auth: 'admin@aawraq.test', admin: true },
  { name: 'admin-books', path: '/admin/books', ref: '/pages/admin/books.html', auth: 'admin@aawraq.test', admin: true },
]

async function authCookies(email: string) {
  const c = anonClient()
  const { data, error } = await c.auth.signInWithPassword({ email, password: DEV_PASSWORD })
  if (error || !data.session) throw new Error(error?.message)
  const header = sessionCookieHeader(data.session)
  return header.split('; ').map((kv) => { const i = kv.indexOf('='); return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' } })
}

async function settle(page: Page) {
  await page.waitForLoadState('load').catch(() => {})
  await page.waitForFunction(() => !document.querySelector('.fa-spin'), null, { timeout: 8000 }).catch(() => {})
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' })
  await page.waitForTimeout(700)
}

function diff(a: string, b: string) {
  const A = PNG.sync.read(readFileSync(a)), B = PNG.sync.read(readFileSync(b))
  const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height, 1800) // compare the top 1800px
  const crop = (p: PNG) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(p, o, 0, 0, w, h, 0, 0); return o }
  const ca = crop(A), cb = crop(B), out = new PNG({ width: w, height: h })
  const n = pixelmatch(ca.data, cb.data, out.data, w, h, { threshold: 0.2 })
  return { pct: +((n / (w * h)) * 100).toFixed(2), out, sizeNew: [A.width, A.height], sizeRef: [B.width, B.height] }
}

const results: Record<string, unknown>[] = []
test.afterAll(() => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2))
})

for (const vp of VIEWPORTS) {
  for (const s of SHOTS) {
    test(`${s.name} @ ${vp.name}`, async ({ browser }) => {
      for (const d of ['new', 'ref', 'diff']) mkdirSync(`${OUT}${d}`, { recursive: true })
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar' })
      if (s.auth) await ctx.addCookies(await authCookies(s.auth))
      const page = await ctx.newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))

      const resp = await page.goto(`http://localhost:3000${s.path}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      const status = resp?.status() ?? 0
      const dir = await page.evaluate(() => document.documentElement.dir)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      const file = `${s.name}-${vp.name}.png`
      await page.screenshot({ path: `${OUT}new/${file}`, fullPage: true })

      let refPct: number | null = null
      let refNote = ''
      try {
        const rp = await ctx.newPage()
        const rr = await rp.goto(`${REF}${s.ref}?clean`, { waitUntil: 'domcontentloaded', timeout: 8000 })
        if (rr?.ok()) {
          await settle(rp)
          await rp.screenshot({ path: `${OUT}ref/${file}`, fullPage: true })
          const d = diff(`${OUT}new/${file}`, `${OUT}ref/${file}`)
          refPct = d.pct
          writeFileSync(`${OUT}diff/${file}`, PNG.sync.write(d.out))
          refNote = `new ${d.sizeNew.join('x')} vs ref ${d.sizeRef.join('x')}`
        }
      } catch { refNote = 'reference server not reachable' }

      results.push({ page: s.name, viewport: vp.name, status, dir, overflowPx: overflow, diffPct: refPct, refNote, pageErrors: errors })
      await ctx.close()

      expect(status, `${s.path} status`).toBeLessThan(400)
      expect(dir).toBe('rtl')
      expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(1)
      expect(errors, 'uncaught page errors').toEqual([])
    })
  }
}
