import { describe, expect, it } from 'vitest'
import { apiAs, APP_URL, serviceClient } from '../helpers/supabase'

// Each test run uses its own X-Forwarded-For so the in-memory contact rate limiter never leaks between runs.
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const get = (p: string) => fetch(`${APP_URL}${p}`, { redirect: 'manual', headers: { accept: 'text/html' } })

describe('public pages are database driven', () => {
  it.each(['/search', '/categories', '/authors', '/articles', '/contact', '/login', '/register', '/forgot-password'])('%s renders', async (p) => {
    const r = await get(p)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('wp_nav')
  })

  it('home/search list demo books from Supabase', async () => {
    const html = await (await get('/search?t=' + Date.now())).text()
    expect(html).toContain('كتاب تجريبي رقم')
    expect(html).toContain('book_block')
  })

  it('book page shows DB category + maker + JSON-LD and never leaks storage paths', async () => {
    const html = await (await get('/book/1?t=' + Date.now())).text()
    expect(html).toContain('product_wp')
    expect(html).toContain('قسم تجريبي')
    expect(html).toContain('application/ld+json')
    expect(html).not.toContain('private-products')
    expect(html).not.toContain('storage_path')
  })

  it('unknown and draft books are 404', async () => {
    expect((await get('/book/999999')).status).toBe(404)
    const { data } = await serviceClient().from('books').select('id').eq('status', 'draft').eq('is_demo', true).limit(1)
    if (data?.[0]) expect((await get(`/book/${data[0].id}?t=${Date.now()}`)).status).toBe(404)
  })

  it('category filter limits the grid', async () => {
    const html = await (await get('/search?category=1&t=' + Date.now())).text()
    expect(html).toContain('book_block')
  })

  it('legacy URLs redirect (301) to canonical routes', async () => {
    const a = await get('/product/3')
    expect(a.status).toBe(301)
    expect(a.headers.get('location')).toBe('/book/3')
    const b = await get('/article/2')
    expect(b.status).toBe(301)
    expect(b.headers.get('location')).toBe('/post/2')
  })

  it('CMS page and article render sanitised content', async () => {
    expect((await get('/p/terms?t=' + Date.now())).status).toBe(200)
    expect((await get('/p/nope-' + Date.now())).status).toBe(404)
    expect((await get('/post/1?t=' + Date.now())).status).toBe(200)
  })
})

describe('sitemap / robots', () => {
  it('sitemap lists published books only', async () => {
    const r = await fetch(`${APP_URL}/sitemap.xml`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('xml')
    const xml = await r.text()
    expect(xml).toContain('<loc>')
    expect(xml).toContain('/book/1/')
    const { data } = await serviceClient().from('books').select('id').eq('status', 'draft').eq('is_demo', true).limit(1)
    if (data?.[0]) expect(xml).not.toContain(`/book/${data[0].id}/`)
  })
  it('robots disallows private areas', async () => {
    const t = await (await fetch(`${APP_URL}/robots.txt`)).text()
    expect(t).toContain('Disallow: /admin')
    expect(t).toContain('Sitemap:')
  })
})

describe('POST /api/contact', () => {
  const valid = { name: 'مرسل تجريبي', email: 'sender@example.invalid', subject: 'note', message: 'رسالة اختبار آلية' }
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${APP_URL}/api/contact`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('rejects invalid input', async () => {
    const h = { 'x-forwarded-for': ip() }
    expect((await post({ ...valid, email: 'nope' }, h)).status).toBe(400)
    expect((await post({ ...valid, subject: 'hack' }, h)).status).toBe(400)
    expect((await post({ ...valid, message: 'x' }, h)).status).toBe(400)
  })

  it('stores a valid message, ignores honeypot submissions', async () => {
    const h = { 'x-forwarded-for': ip() }
    const marker = `اختبار-${Date.now()}`
    expect((await post({ ...valid, message: marker }, h)).status).toBe(200)
    const db = serviceClient()
    const { data } = await db.from('contact_messages').select('id,user_id').eq('message', marker)
    expect(data).toHaveLength(1)

    const bot = `bot-${Date.now()}`
    expect((await post({ ...valid, message: bot, website: 'http://spam.test' }, h)).status).toBe(200)
    const { data: none } = await db.from('contact_messages').select('id').eq('message', bot)
    expect(none).toHaveLength(0)
    await db.from('contact_messages').delete().eq('message', marker)
  })

  it('attaches the signed-in user and rate limits bursts', async () => {
    const api = await apiAs('customer@aawraq.test')
    const marker = `auth-${Date.now()}`
    const r = await api('/api/contact', { method: 'POST', json: { ...valid, message: marker }, headers: { 'x-forwarded-for': ip() } })
    expect(r.status).toBe(200)
    const { data } = await serviceClient().from('contact_messages').select('id,user_id').eq('message', marker)
    expect(data?.[0]?.user_id).toBeTruthy()
    await serviceClient().from('contact_messages').delete().eq('message', marker)

    const h = { 'x-forwarded-for': ip() }
    const codes: number[] = []
    for (let i = 0; i < 8; i++) codes.push((await post({ ...valid, website: 'bot' }, h)).status)
    expect(codes).toContain(429)
  })
})

describe('POST /api/views/:entity/:id', () => {
  it('rejects unknown entities and ids', async () => {
    const h = { 'x-forwarded-for': ip() }
    expect((await fetch(`${APP_URL}/api/views/user/1`, { method: 'POST', headers: h })).status).toBe(400)
    expect((await fetch(`${APP_URL}/api/views/book/abc`, { method: 'POST', headers: h })).status).toBe(400)
  })
  it('increments a book view counter atomically', async () => {
    const db = serviceClient()
    const before = (await db.from('books').select('view_count').eq('id', 2).single()).data!.view_count
    const r = await fetch(`${APP_URL}/api/views/book/2`, { method: 'POST', headers: { 'x-forwarded-for': ip() } })
    expect(r.status).toBe(200)
    const after = (await db.from('books').select('view_count').eq('id', 2).single()).data!.view_count
    expect(after).toBe(before + 1)
  })
})
