// Browser walk-through of the customer commerce flow against the LOCAL stack (dev server on :3000).
//   node scripts/dev/e2e-commerce.mjs        -> exits non-zero on the first failed step
// login -> add to cart -> cart (server-priced) -> pledge gate -> dev simulator -> invoice -> library -> download
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const admin = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const BASE = process.env.TEST_APP_URL ?? 'http://localhost:3000'
const email = `e2e-${randomUUID().slice(0, 8)}@aawraq.test`
const { error } = await admin.auth.admin.createUser({ email, password: 'Local-Dev-Pass-2026!', email_confirm: true })
if (error) throw error

const { data: book } = await admin.from('books').select('id,title,price_amount,book_media!inner(id)').eq('is_demo', true).eq('kind', 'paid').eq('status', 'published').eq('book_media.visibility', 'after_purchase').limit(1).single()
const step = (m) => console.log('✓', m)
const assert = (c, m) => { if (!c) { console.error('✗', m); process.exitCode = 1; throw new Error(m) } }

// PW_CHROMIUM lets you point at an already-installed Chromium when `npx playwright install` has not matched the library version
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, headless: true })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' })).newPage()
page.on('pageerror', (e) => console.warn('pageerror:', e.message))
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' }) // wait for hydration before using the form
  await page.fill('#l-email', email)
  await page.fill('#password', 'Local-Dev-Pass-2026!')
  await page.click('form.wp_form button[type=submit]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
  step('signed in')

  await page.goto(`${BASE}/search?search=${encodeURIComponent(book.title)}`, { waitUntil: 'networkidle' })
  await page.locator('.book_block .addToCartBtn').first().click()
  await page.waitForTimeout(300)
  await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#products_cart .block')
  const total = (await page.textContent('#total_cart_item span')).trim()
  assert(total === Number(book.price_amount).toFixed(2), `cart total is server-priced (${total})`)
  step(`cart shows server total ${total}`)

  await page.click('#payment-form-container button[type=submit]')
  await page.waitForSelector('#agree_deal_pay_modal.show')
  await page.click('#agree_deal_pay_form .agree_btn') // not ticked -> must be refused
  assert(page.url().includes('/cart'), 'pledge gate blocks payment until ticked')
  assert(await page.isVisible('#agree_deal_pay_err'), 'pledge error shown')
  await page.check('#agree_deal_pay_input')
  await page.click('#agree_deal_pay_form .agree_btn')
  await page.waitForURL(/\/checkout\/simulate\//, { timeout: 15000 })
  await page.waitForSelector('text=DEVELOPMENT SIMULATION')
  assert(true, 'simulator banner visible')
  step('pledge gate + simulator banner')

  await page.click('text=Simulate success')
  await page.waitForURL(/\/invoice\/\d+\?purchased=1/, { timeout: 20000 })
  await page.waitForSelector('#invoice_sec')
  assert((await page.textContent('body')).includes('طلب تجريبي'), 'invoice flags test order')
  step('invoice: ' + page.url())

  await page.goto(`${BASE}/library?purchased=1`)
  await page.waitForSelector('.wp_favourite .book_block')
  assert((await page.textContent('.wp_favourite')).includes('تجريبي'), 'library marks test purchase')
  step('library lists the book with the test badge')

  const res = await page.request.get(`${BASE}/api/library/download/${book.book_media[0].id}`, { maxRedirects: 0 })
  assert(res.status() === 302, 'download is a 302 to a signed URL')
  step('download 302')

  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(`${BASE}/library`)
  await page.waitForSelector('.wp_favourite .book_block')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal overflow at 390px')
  step('mobile: no horizontal overflow')
} finally { await browser.close() }
console.log('E2E commerce flow OK')
