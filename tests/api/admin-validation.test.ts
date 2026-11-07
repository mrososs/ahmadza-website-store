// Admin write validation: bad input is a 400 with a clear ARABIC message (the same text the forms show), never a 5xx, and nothing is written.
// Found by the admin browser sweep (tests/e2e/admin-sweep.spec.ts): the forms and the API used to answer with raw English schema text,
// and a `javascript:` URL could be saved into the site-wide social links that the storefront footer renders as <a href>.
// Run against the dev server (TEST_APP_URL, default http://localhost:3000) + LOCAL Supabase.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiAs, DEV_USERS, serviceClient } from '../helpers/supabase'

type Api = Awaited<ReturnType<typeof apiAs>>
let admin: Api
const db = serviceClient()
const TAG = '[sweep-test] validation'
let settingsBefore: Record<string, unknown> | null = null

beforeAll(async () => {
  admin = await apiAs(DEV_USERS.admin)
  settingsBefore = (await db.from('site_settings').select('*').eq('id', 1).single()).data as Record<string, unknown>
})
afterAll(async () => {
  await db.from('books').delete().like('title', `${TAG}%`)
  await db.from('categories').delete().like('name', `${TAG}%`)
  await db.from('pages').delete().like('title', `${TAG}%`)
  if (settingsBefore) await db.from('site_settings').update(settingsBefore as never).eq('id', 1)
})

async function refused(path: string, body: unknown, method = 'POST') {
  const res = await admin(path, { method, json: body })
  const j = (await res.json().catch(() => ({}))) as { statusMessage?: string; message?: string }
  const message = String(j.statusMessage ?? j.message ?? '')
  expect(res.status, `${method} ${path} ${JSON.stringify(body).slice(0, 80)} -> ${message}`).toBe(400)
  expect(message, 'Arabic message').toMatch(/[؀-ۿ]/)
  expect(message.replace(/https?:\/\/\S*/g, ''), 'no raw English schema text').not.toMatch(/[A-Za-z]{5,}/)
  return message
}

const BOOK = { title: `${TAG} book`, kind: 'paid', status: 'draft', price_amount: 5, pages: 0, category_ids: [], maker_ids: [], tags: [] }
const SETTINGS = {
  site_name: 'أوراق عربية', show_free_book_button: true, affiliate_commission_percent: 10, commission_freeze_days: 30, min_withdrawal_amount: 100,
  show_poster_desktop: false, show_poster_mobile: false, payment_mode: 'test', require_admin_mfa: false,
}

describe('book create/update refuses bad input in Arabic', () => {
  it('missing, empty and over-long title', async () => {
    await refused('/api/admin/books', {})
    await refused('/api/admin/books', { ...BOOK, title: '' })
    await refused('/api/admin/books', { ...BOOK, title: 'ع'.repeat(251) })
  })
  it('negative, non-numeric and absurd price', async () => {
    expect(await refused('/api/admin/books', { ...BOOK, price_amount: -5 })).toContain('سالباً')
    await refused('/api/admin/books', { ...BOOK, price_amount: 'abc' })
    await refused('/api/admin/books', { ...BOOK, price_amount: 1e9 })
  })
  it('paid + published + price 0, and a free book with a price', async () => {
    expect(await refused('/api/admin/books', { ...BOOK, status: 'published', price_amount: 0 })).toContain('الكتاب المدفوع يحتاج سعراً')
    await refused('/api/admin/books', { ...BOOK, kind: 'free', price_amount: 3 })
  })
  it('unknown kind/status and bad page count', async () => {
    await refused('/api/admin/books', { ...BOOK, kind: 'bundle' })
    await refused('/api/admin/books', { ...BOOK, status: 'deleted' })
    await refused('/api/admin/books', { ...BOOK, pages: -1 })
    await refused('/api/admin/books', { ...BOOK, pages: 1.5 })
  })
  it('nothing was written by the refused requests', async () => {
    const { count } = await db.from('books').select('id', { count: 'exact', head: true }).like('title', `${TAG}%`)
    expect(count).toBe(0)
  })
})

describe('category / maker / article / page refuse bad input in Arabic', () => {
  it('empty and over-long names', async () => {
    await refused('/api/admin/categories', {})
    await refused('/api/admin/categories', { name: '   ' })
    await refused('/api/admin/categories', { name: 'ع'.repeat(121) })
    await refused('/api/admin/makers', { name: '', kind: 'author', era: 'new' })
    await refused('/api/admin/makers', { name: 'x', kind: 'villain', era: 'new' })
    await refused('/api/admin/articles', { title: '', status: 'draft' })
    await refused('/api/admin/pages', { slug: 'ok', title: '', status: 'draft' })
  })
  it('page slug rules', async () => {
    expect(await refused('/api/admin/pages', { slug: 'has space', title: `${TAG} p`, status: 'draft' })).toContain('الرابط')
    await refused('/api/admin/pages', { slug: 'a/b', title: `${TAG} p`, status: 'draft' })
    await refused('/api/admin/pages', { slug: '', title: `${TAG} p`, status: 'draft' })
  })
})

describe('site settings refuse bad input in Arabic', () => {
  it('bad e-mail', async () => {
    expect(await refused('/api/admin/settings', { ...SETTINGS, email: 'not-an-email' }, 'PUT')).toContain('البريد')
  })
  it('social links must be http(s) URLs: javascript:/data:/plain text are refused, https and empty are accepted', async () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'not a url', 'ftp://x.test/a', 'x'.repeat(301)]) {
      await refused('/api/admin/settings', { ...SETTINGS, facebook: bad }, 'PUT')
    }
    await refused('/api/admin/settings', { ...SETTINGS, linkedin: 'javascript:void(0)' }, 'PUT')
    const ok = await admin('/api/admin/settings', { method: 'PUT', json: { ...SETTINGS, facebook: 'https://facebook.com/aawraq-validation', twitter: '', instagram: null } })
    expect(ok.status).toBe(200)
    const saved = (await db.from('site_settings').select('facebook').eq('id', 1).single()).data
    expect(saved?.facebook).toBe('https://facebook.com/aawraq-validation')
  })
  it('commission, freeze days and minimum withdrawal bounds', async () => {
    await refused('/api/admin/settings', { ...SETTINGS, affiliate_commission_percent: 150 }, 'PUT')
    await refused('/api/admin/settings', { ...SETTINGS, affiliate_commission_percent: -1 }, 'PUT')
    await refused('/api/admin/settings', { ...SETTINGS, commission_freeze_days: 400 }, 'PUT')
    await refused('/api/admin/settings', { ...SETTINGS, min_withdrawal_amount: -5 }, 'PUT')
    await refused('/api/admin/settings', { ...SETTINGS, affiliate_commission_percent: 'abc' }, 'PUT')
    await refused('/api/admin/settings', { ...SETTINGS, site_name: '' }, 'PUT')
  })
})

describe('database conflicts and lookups answer in Arabic, never as raw Postgres text or 500', () => {
  it('a duplicate page slug is a 409 with an Arabic message', async () => {
    const slug = `sweep-dup-${Date.now()}`
    const page = { slug, title: `${TAG} page`, status: 'draft', positions: [] }
    expect((await admin('/api/admin/pages', { method: 'POST', json: page })).status).toBe(201)
    const dup = await admin('/api/admin/pages', { method: 'POST', json: page })
    const j = (await dup.json()) as { statusMessage?: string }
    expect(dup.status).toBe(409)
    expect(j.statusMessage).toMatch(/[؀-ۿ]/)
    expect(j.statusMessage).not.toMatch(/duplicate key|constraint/i)
  })
  it('the orders search is an invoice-number lookup: a non-numeric, over-long or out-of-range term matches nothing (not everything, not a 400/500)', async () => {
    const all = (await (await admin('/api/admin/orders')).json()) as { total: number }
    expect(all.total).toBeGreaterThan(0)
    for (const q of ['zzz-no-such-row-zzz', '99999999999', 'x'.repeat(100), '%']) {
      const res = await admin(`/api/admin/orders?q=${encodeURIComponent(q)}`)
      expect(res.status, q).toBe(200)
      expect(((await res.json()) as { total: number }).total, q).toBe(0)
    }
    const one = (await db.from('orders').select('order_no').limit(1).single()).data!.order_no
    expect(((await (await admin(`/api/admin/orders?q=${one}`)).json()) as { total: number }).total).toBe(1)
  })
})

describe('a list page past the end is a 404 with an Arabic message (a stale ?page= bookmark), never a 500', () => {
  for (const route of ['/api/admin/contacts', '/api/admin/comments', '/api/admin/orders', '/api/admin/categories', '/api/admin/books', '/api/admin/makers', '/api/admin/pages']) {
    it(route, async () => {
      const res = await admin(`${route}?page=99999`)
      expect(res.status).toBe(404)
      expect(((await res.json()) as { statusMessage: string }).statusMessage).toMatch(/[؀-ۿ]/)
    })
  }
})
