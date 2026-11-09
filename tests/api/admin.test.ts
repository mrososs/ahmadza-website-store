// Admin API tests (slice C). Run against the dev server (TEST_APP_URL, default http://localhost:3000) + LOCAL Supabase.
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'

type Api = Awaited<ReturnType<typeof apiAs>>
let guest: Api, customer: Api, affiliate: Api, admin: Api
const db = serviceClient()

const MIN_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

function form(file: Buffer, filename: string, type: string, fields: Record<string, string> = {}) {
  const f = new FormData()
  f.set('file', new Blob([new Uint8Array(file)], { type }), filename)
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeAll(async () => {
  guest = await apiAs(null)
  customer = await apiAs(DEV_USERS.customer)
  affiliate = await apiAs(DEV_USERS.affiliate)
  admin = await apiAs(DEV_USERS.admin)
})

const READ_ROUTES = [
  '/api/admin/me', '/api/admin/badges', '/api/admin/dashboard', '/api/admin/lookups', '/api/admin/books', '/api/admin/books/1',
  '/api/admin/books/1/media', '/api/admin/categories', '/api/admin/makers', '/api/admin/articles', '/api/admin/pages',
  '/api/admin/users', '/api/admin/orders', '/api/admin/contacts', '/api/admin/comments', '/api/admin/settings',
  '/api/admin/stats/books', '/api/admin/stats/revenue', '/api/admin/demo',
]

describe('authorisation: 401 guest / 403 customer+affiliate / 200 admin', () => {
  for (const route of READ_ROUTES) {
    it(`GET ${route}`, async () => {
      expect((await guest(route)).status).toBe(401)
      expect((await customer(route)).status).toBe(403)
      expect((await affiliate(route)).status).toBe(403)
      expect((await admin(route)).status).toBe(200)
    })
  }

  const WRITES: [string, string, unknown?][] = [
    ['POST', '/api/admin/categories', { name: 'x' }], ['PUT', '/api/admin/categories/1', { name: 'x' }], ['DELETE', '/api/admin/categories/1'],
    ['POST', '/api/admin/books', {}], ['PUT', '/api/admin/books/1', {}], ['DELETE', '/api/admin/books/1'], ['POST', '/api/admin/books/1/clone'],
    ['POST', '/api/admin/books/1/restore'], ['POST', '/api/admin/books/bulk', { operation: 'make_free', ids: [1] }], ['POST', '/api/admin/books/1/media', {}], ['DELETE', '/api/admin/books/1/media/1'],
    ['PUT', '/api/admin/settings', {}], ['PATCH', '/api/admin/users/00000000-0000-0000-0000-000000000000', { status: 'active' }],
    ['DELETE', '/api/admin/users/00000000-0000-0000-0000-000000000000'], ['PATCH', '/api/admin/contacts/1', { is_handled: true }],
    ['DELETE', '/api/admin/contacts/1'], ['PATCH', '/api/admin/comments/1', { status: 'approved' }], ['DELETE', '/api/admin/comments/1'],
    ['DELETE', '/api/admin/demo', { confirm: 'DELETE-DEMO' }],
  ]
  for (const [method, route, body] of WRITES) {
    it(`${method} ${route} is closed to non-admins`, async () => {
      const init = { method, json: body ?? {} }
      expect((await guest(route, init)).status).toBe(401)
      expect((await customer(route, init)).status).toBe(403)
      expect((await affiliate(route, init)).status).toBe(403)
    })
  }
})

describe('categories: validation, soft delete / restore, audit', () => {
  let id = 0
  it('rejects an empty name (400)', async () => {
    expect((await admin('/api/admin/categories', { method: 'POST', json: { name: '  ' } })).status).toBe(400)
  })
  it('creates, lists, soft-deletes and restores', async () => {
    const created = await admin('/api/admin/categories', { method: 'POST', json: { name: `قسم اختبار ${Date.now()}`, is_active: true } })
    expect(created.status).toBe(201)
    id = (await created.json()).id
    let list = await (await admin('/api/admin/categories?status=active&page=1')).json()
    expect(list.items.some((c: { id: number }) => c.id === id)).toBe(true)
    expect((await admin(`/api/admin/categories/${id}`, { method: 'DELETE' })).status).toBe(200)
    list = await (await admin('/api/admin/categories?status=trash')).json()
    expect(list.items.some((c: { id: number }) => c.id === id)).toBe(true)
    list = await (await admin('/api/admin/categories?status=all')).json()
    expect(list.items.some((c: { id: number }) => c.id === id)).toBe(false)
    expect((await admin(`/api/admin/categories/${id}/restore`, { method: 'POST' })).status).toBe(200)
    list = await (await admin('/api/admin/categories?status=active')).json()
    expect(list.items.some((c: { id: number }) => c.id === id)).toBe(true)
    // the row is still there: soft delete never removes data
    const { data } = await db.from('categories').select('id,deleted_at').eq('id', id).single()
    expect(data?.deleted_at).toBeNull()
  })
  it('writes audit_log rows carrying the acting admin', async () => {
    const adminId = (await signedInClient(DEV_USERS.admin)).userId
    const { data } = await db.from('audit_log').select('action,actor_id').eq('entity', 'categories').eq('entity_id', String(id)).eq('actor_id', adminId)
    expect(data?.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'soft_delete', 'restore']))
  })
})

describe('rich text is sanitised on save', () => {
  it('strips scripts and event handlers from an article', async () => {
    const evil = '<p onclick="steal()">ok</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">l</a>'
    const res = await admin('/api/admin/articles', { method: 'POST', json: { title: 'مقال اختبار', status: 'draft', content_html: evil } })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    const got = await (await admin(`/api/admin/articles/${id}`)).json()
    expect(got.content_html).toContain('ok')
    expect(got.content_html).not.toMatch(/<script|onerror|onclick|javascript:/i)
    await admin(`/api/admin/articles/${id}`, { method: 'DELETE' })
  })
  it('sanitises page and maker HTML too', async () => {
    const slug = `t-${Date.now()}`
    const p = await admin('/api/admin/pages', { method: 'POST', json: { slug, title: 'صفحة', status: 'draft', positions: [], content_html: '<iframe src="//evil"></iframe><b>x</b>' } })
    expect(p.status).toBe(201)
    const { id } = await p.json()
    expect((await (await admin(`/api/admin/pages/${id}`)).json()).content_html).not.toMatch(/iframe/i)
    await admin(`/api/admin/pages/${id}`, { method: 'DELETE' })
    const m = await admin('/api/admin/makers', { method: 'POST', json: { name: 'مؤلف اختبار', kind: 'author', era: 'new', bio_html: '<script>x</script><i>bio</i>' } })
    const mid = (await m.json()).id
    expect((await (await admin(`/api/admin/makers/${mid}`)).json()).bio_html).toBe('<i>bio</i>')
    await admin(`/api/admin/makers/${mid}`, { method: 'DELETE' })
  })
  it('rejects a page slug containing spaces or slashes (400)', async () => {
    expect((await admin('/api/admin/pages', { method: 'POST', json: { slug: 'a b', title: 't', status: 'draft' } })).status).toBe(400)
    expect((await admin('/api/admin/pages', { method: 'POST', json: { slug: 'a/b', title: 't', status: 'draft' } })).status).toBe(400)
  })
})

describe('books CRUD, clone, media', () => {
  let bookId = 0
  const base = { title: 'كتاب اختبار الإدارة', kind: 'paid', status: 'draft', price_amount: 7.5, pages: 10, category_ids: [], maker_ids: [], tags: ['اختبار'], description_html: '<p>x<script>y</script></p>' }

  it('rejects a paid published book with zero price and a free book with a price (400)', async () => {
    expect((await admin('/api/admin/books', { method: 'POST', json: { ...base, status: 'published', price_amount: 0 } })).status).toBe(400)
    expect((await admin('/api/admin/books', { method: 'POST', json: { ...base, kind: 'free', price_amount: 3 } })).status).toBe(400)
  })
  it('creates a book (description sanitised), edits, clones, soft-deletes, restores', async () => {
    const created = await admin('/api/admin/books', { method: 'POST', json: base })
    expect(created.status).toBe(201)
    bookId = (await created.json()).id
    let b = await (await admin(`/api/admin/books/${bookId}`)).json()
    expect(b.description_html).toBe('<p>x</p>')
    expect(b.tags).toEqual(['اختبار'])
    expect((await admin(`/api/admin/books/${bookId}`, { method: 'PUT', json: { ...base, title: 'عنوان معدّل', status: 'published', tags: ['أ', 'ب'] } })).status).toBe(200)
    b = await (await admin(`/api/admin/books/${bookId}`)).json()
    expect(b.title).toBe('عنوان معدّل')
    expect(b.status).toBe('published')
    expect(b.tags.sort()).toEqual(['أ', 'ب'])
    const clone = await admin(`/api/admin/books/${bookId}/clone`, { method: 'POST' })
    expect(clone.status).toBe(201)
    const cid = (await clone.json()).id
    const c = await (await admin(`/api/admin/books/${cid}`)).json()
    expect(c.status).toBe('draft')
    expect(c.title).toContain('عنوان معدّل')
    expect((await admin(`/api/admin/books/${cid}`, { method: 'DELETE' })).status).toBe(200)
    const trash = await (await admin('/api/admin/books?status=trash')).json()
    expect(trash.items.some((x: { id: number }) => x.id === cid)).toBe(true)
    expect((await admin(`/api/admin/books/${cid}/restore`, { method: 'POST' })).status).toBe(200)
    await admin(`/api/admin/books/${cid}`, { method: 'DELETE' })
  })
  it('external media must be https', async () => {
    expect((await admin(`/api/admin/books/${bookId}/media`, { method: 'POST', json: { external_url: 'http://example.invalid/a.pdf', name: 'x' } })).status).toBe(400)
    expect((await admin(`/api/admin/books/${bookId}/media`, { method: 'POST', json: { external_url: 'javascript:alert(1)', name: 'x' } })).status).toBe(400)
    const ok = await admin(`/api/admin/books/${bookId}/media`, { method: 'POST', json: { external_url: 'https://example.invalid/a.pdf', name: 'خارجي', visibility: 'preview' } })
    expect(ok.status).toBe(201)
  })
  it('accepts a real PDF, stores it privately with sha256, and can update / delete it', async () => {
    const res = await admin(`/api/admin/books/${bookId}/media`, { method: 'POST', body: form(MIN_PDF, 'book.pdf', 'application/pdf', { visibility: 'after_purchase', name: 'ملف' }) })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    const { data: row } = await db.from('book_media').select('storage_path,sha256,byte_size,mime_type').eq('id', id).single()
    expect(row?.mime_type).toBe('application/pdf')
    expect(row?.byte_size).toBe(MIN_PDF.length)
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/)
    const dl = await db.storage.from('private-products').download(row!.storage_path!)
    expect(dl.error).toBeNull()
    // not world readable
    const pub = await fetch(`${process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321'}/storage/v1/object/public/private-products/${row!.storage_path}`)
    expect(pub.status).not.toBe(200)
    expect((await admin(`/api/admin/books/${bookId}/media/${id}`, { method: 'PUT', json: { visibility: 'preview', name: 'جديد', sort_order: 3 } })).status).toBe(200)
    expect((await admin(`/api/admin/books/${bookId}/media/${id}`, { method: 'DELETE' })).status).toBe(200)
    const gone = await db.storage.from('private-products').download(row!.storage_path!)
    expect(gone.error).not.toBeNull()
  })
  it('refuses hostile payloads disguised as PDF / audio (415) and non-multipart garbage', async () => {
    const phpInMp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.from('<?php system($_GET["c"]); ?>')])
    const payloads: [string, Buffer, string][] = [
      ['shell.php.pdf', Buffer.from('<?php system($_GET["c"]); ?> padding padding'), 'application/pdf'],
      ['trojan.pdf', Buffer.concat([MIN_PDF, Buffer.from('<?php eval($_POST[1]); ?>')]), 'application/pdf'],
      ['a.mp3', phpInMp4, 'audio/mpeg'],
      ['x.pdf', Buffer.from('<html><script>alert(1)</script></html> padding padding'), 'application/pdf'],
      ['x.pdf', Buffer.from('<?php __HALT_COMPILER(); ?>\x00\x00 phar stub padding padding'), 'application/pdf'],
      ['mvg.pdf', Buffer.from("push graphic-context\nviewbox 0 0 640 480\nfill 'url(https://x.invalid/a.jpg\"|id\")'\npop graphic-context"), 'application/pdf'],
      ['.htaccess', Buffer.from('AddType application/x-httpd-php .gif\nphp_value auto_prepend_file /tmp/s.php'), 'text/plain'],
    ]
    for (const [name, buf, type] of payloads) {
      const res = await admin(`/api/admin/books/${bookId}/media`, { method: 'POST', body: form(buf, name, type) })
      expect(res.status, name).toBe(415)
    }
    const { count } = await db.from('book_media').select('id', { count: 'exact', head: true }).eq('book_id', bookId).eq('name', 'ملف')
    expect(count).toBe(0)
  })
  it('refuses a missing file part (400) and an invalid visibility (400)', async () => {
    const f = new FormData(); f.set('visibility', 'preview')
    expect((await admin(`/api/admin/books/${bookId}/media`, { method: 'POST', body: f })).status).toBe(400)
    expect((await admin(`/api/admin/books/${bookId}/media`, { method: 'POST', body: form(MIN_PDF, 'a.pdf', 'application/pdf', { visibility: 'everyone' }) })).status).toBe(400)
  })
  it('cover upload: accepts a real PNG, refuses a disguised script and an oversize image', async () => {
    const ok = await admin(`/api/admin/images/books/${bookId}`, { method: 'POST', body: form(PNG_1X1, 'c.png', 'image/png') })
    expect(ok.status).toBe(200)
    const { path } = await ok.json()
    expect(path).toMatch(/^books\/\d+\/.+\.png$/)
    const html = await admin(`/api/admin/images/books/${bookId}`, { method: 'POST', body: form(Buffer.from('<html><body onload=alert(1)> padding'), 'c.png', 'image/png') })
    expect(html.status).toBe(415)
    const svg = await admin(`/api/admin/images/books/${bookId}`, { method: 'POST', body: form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'c.png', 'image/png') })
    expect(svg.status).toBe(415)
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(3 * 1024 * 1024)])
    expect((await admin(`/api/admin/images/books/${bookId}`, { method: 'POST', body: form(big, 'big.png', 'image/png') })).status).toBe(413)
    const pdfAsImage = await admin(`/api/admin/images/books/${bookId}`, { method: 'POST', body: form(MIN_PDF, 'c.png', 'image/png') })
    expect(pdfAsImage.status).toBe(415)
  })
  it('cleans up', async () => {
    expect((await admin(`/api/admin/books/${bookId}`, { method: 'DELETE' })).status).toBe(200)
  })
})

describe('users, settings, orders, reports', () => {
  it('lists users with e-mail search and changes a status; refuses self-change', async () => {
    const list = await (await admin(`/api/admin/users?q=customer2`)).json()
    const u = list.items.find((x: { email: string }) => x.email === DEV_USERS.customer2)
    expect(u).toBeTruthy()
    expect((await admin(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { status: 'review' } })).status).toBe(200)
    expect((await (await admin(`/api/admin/users/${u.id}`)).json()).status).toBe('review')
    expect((await admin(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { status: 'active' } })).status).toBe(200)
    expect((await admin(`/api/admin/users/${u.id}`, { method: 'PATCH', json: { status: 'superadmin' } })).status).toBe(400)
    const me = await (await admin('/api/admin/me')).json()
    expect((await admin(`/api/admin/users/${me.id}`, { method: 'PATCH', json: { status: 'banned' } })).status).toBe(403)
    expect((await admin(`/api/admin/users/${me.id}`, { method: 'DELETE' })).status).toBe(403)
  })
  it('settings: validates ranges, never exposes commission to the public API, never touches allow_test_payments', async () => {
    const cur = await (await admin('/api/admin/settings')).json()
    expect(cur.pending_owner_confirmation).toContain('affiliate_commission_percent')
    const body = {
      site_name: cur.site_name, phone: cur.phone, email: cur.email ?? '', description: cur.description, keywords: cur.keywords,
      show_free_book_button: cur.show_free_book_button, affiliate_commission_percent: cur.affiliate_commission_percent,
      commission_freeze_days: cur.commission_freeze_days, min_withdrawal_amount: Number(cur.min_withdrawal_amount),
      show_poster_desktop: cur.show_poster_desktop, show_poster_mobile: cur.show_poster_mobile, payment_mode: cur.payment_mode,
      require_admin_mfa: cur.require_admin_mfa, allow_test_payments: false,
    }
    expect((await admin('/api/admin/settings', { method: 'PUT', json: { ...body, affiliate_commission_percent: 150 } })).status).toBe(400)
    expect((await admin('/api/admin/settings', { method: 'PUT', json: { ...body, commission_freeze_days: -1 } })).status).toBe(400)
    expect((await admin('/api/admin/settings', { method: 'PUT', json: body })).status).toBe(200)
    const after = await (await admin('/api/admin/settings')).json()
    expect(after.allow_test_payments).toBe(cur.allow_test_payments) // not writable through this route
  })
  it('orders list/detail are read-only (no write routes exist)', async () => {
    const list = await (await admin('/api/admin/orders')).json()
    expect(Array.isArray(list.items)).toBe(true)
    if (list.items[0]) {
      const d = await admin(`/api/admin/orders/${list.items[0].order_no}`)
      expect(d.status).toBe(200)
    }
    expect([404, 405]).toContain((await admin('/api/admin/orders/1', { method: 'PATCH', json: { status: 'refunded' } })).status)
    expect([404, 405]).toContain((await admin('/api/admin/orders/1', { method: 'DELETE' })).status)
  })
  it('reports: JSON and CSV (formula-safe), unknown report 404', async () => {
    const r = await admin('/api/admin/stats/books?from=2020-01-01&to=2099-01-01')
    expect(r.status).toBe(200)
    expect((await r.json()).kind).toBe('books')
    const csv = await admin('/api/admin/stats/books?format=csv')
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect(await csv.text()).toContain('id,title')
    expect((await admin('/api/admin/stats/nope')).status).toBe(404)
    expect((await admin('/api/admin/stats/books?from=notadate')).status).toBe(400)
  })
  it('demo purge needs the typed confirmation (wrong value refused, nothing deleted)', async () => {
    expect((await admin('/api/admin/demo', { method: 'DELETE', json: { confirm: 'yes' } })).status).toBe(400)
    const { count } = await db.from('books').select('id', { count: 'exact', head: true }).eq('is_demo', true)
    expect(count).toBeGreaterThan(0)
  })
  it('contacts and comments moderation', async () => {
    const { data: c } = await db.from('contact_messages').insert({ name: 'اختبار', email: 'x@example.invalid', subject: 'note', message: 'رسالة اختبار' }).select('id').single()
    expect((await admin(`/api/admin/contacts/${c!.id}`, { method: 'PATCH', json: { is_handled: true } })).status).toBe(200)
    expect((await (await admin('/api/admin/contacts?status=handled')).json()).items.some((x: { id: number }) => x.id === c!.id)).toBe(true)
    expect((await admin(`/api/admin/contacts/${c!.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await admin('/api/admin/comments/999999', { method: 'PATCH', json: { status: 'approved' } })).status).toBe(404)
    expect((await admin('/api/admin/comments/1', { method: 'PATCH', json: { status: 'bogus' } })).status).toBe(400)
  })
})
