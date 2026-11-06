// End-to-end checks of the REAL Nuxt app running against the HOSTED project.
//   1. in the project dir:  nuxt dev --dotenv .env.hosted --port 3100        (or a copy of the source; the lock forbids a 2nd dev server in one dir)
//   2. HOSTED_TEST_CONFIRM=ubjuyeccioflhpcpnhmo TEST_APP_URL=http://localhost:3100 npm run test:hosted
// Synthetic, tagged records only (see helpers.ts); everything is deleted afterwards. No payment is ever completed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { APP_URL, appAs, cleanupFixtures, createFixtureUser, FIXTURE_TITLE_PREFIX, SUPABASE_URL, serviceClient, type Fixture } from './helpers'

const svc = serviceClient()
type App = Awaited<ReturnType<typeof appAs>>
let guest: App, customer: App, admin: App, affiliate: App
let alice: Fixture, boss: Fixture, aff: Fixture
let paidBook = 0
let freeBook = 0
let draftBook = 0
const mediaIds: Record<string, number> = {}

beforeAll(async () => {
  await cleanupFixtures(svc)
  ;[alice, boss, aff] = [await createFixtureUser(svc, 'alice'), await createFixtureUser(svc, 'boss'), await createFixtureUser(svc, 'aff')]
  await svc.from('user_roles').insert({ user_id: boss.id, role: 'admin' })
  await svc.from('profiles').update({ is_affiliate: true }).eq('id', aff.id)
  const mk = async (suffix: string, kind: 'paid' | 'free', status: 'published' | 'draft') =>
    (await svc.from('books').insert({ title: `${FIXTURE_TITLE_PREFIX}${suffix}`, kind, price_amount: kind === 'paid' ? 7.5 : 0, status }).select('id').single()).data!.id
  paidBook = await mk('paid', 'paid', 'published')
  freeBook = await mk('free', 'free', 'published')
  draftBook = await mk('draft', 'paid', 'draft')
  const media = async (key: string, book: number, visibility: 'preview' | 'after_purchase', extra: Record<string, unknown>) =>
    (mediaIds[key] = (await svc.from('book_media').insert({ book_id: book, visibility, name: `${FIXTURE_TITLE_PREFIX}${key}`, ...extra } as never).select('id').single()).data!.id)
  await media('preview', paidBook, 'preview', { is_external: true, external_url: 'https://example.invalid/preview.pdf' })
  await media('paid', paidBook, 'after_purchase', { is_external: true, external_url: 'https://example.invalid/paid.pdf' })
  await media('pending', paidBook, 'preview', {})
  await media('free', freeBook, 'after_purchase', { is_external: true, external_url: 'https://example.invalid/free.pdf' })
  ;[guest, customer, admin, affiliate] = await Promise.all([appAs(null), appAs(alice), appAs(boss), appAs(aff)])
  // Warm-up: the first request after a dev-server start compiles the page and can exceed a test's own 60 s timeout. Doing it here
  // (the hook allows 120 s) keeps cold start from being reported as a test failure.
  await guest('/')
})
afterAll(async () => { await cleanupFixtures(svc) })

describe('the app is wired to the hosted project (and only it)', () => {
  it('the rendered page carries the hosted project URL, never a local one', async () => {
    const html = await (await guest('/')).text()
    expect(html).toContain(new URL(SUPABASE_URL).hostname)
    expect(html).not.toMatch(/127\.0\.0\.1:54321|localhost:54321/)
    expect(APP_URL).toMatch(/^http:\/\/(localhost|127\.0\.0\.1)/)
  })
})

describe('storefront reads real hosted data — and shows nothing invented', () => {
  it('public pages render', async () => {
    for (const p of ['/', '/categories', '/search', '/authors', '/articles', '/contact', '/login', '/register', '/forgot-password']) {
      expect((await guest(p)).status, p).toBe(200)
    }
  })
  it('a published fixture book renders with its title; a draft and an unknown id are not found', async () => {
    const ok = await guest(`/book/${paidBook}/x`)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain(`${FIXTURE_TITLE_PREFIX}paid`)
    expect((await guest(`/book/${draftBook}/x`)).status).toBe(404)
    expect((await guest('/book/987654321/x')).status).toBe(404)
  })
  it('the hosted catalogue contains only fixture books during the run (no seeded/demo records)', async () => {
    const real = await svc.from('books').select('id', { count: 'exact', head: true }).not('title', 'like', `${FIXTURE_TITLE_PREFIX}%`)
    expect(real.count).toBe(0)
    expect((await svc.from('books').select('id', { count: 'exact', head: true }).eq('is_demo', true)).count).toBe(0)
  })
})

describe('admin API on hosted: guest 401 / customer 403 / admin 200', () => {
  for (const route of ['/api/admin/me', '/api/admin/dashboard', '/api/admin/books', '/api/admin/categories', '/api/admin/makers', '/api/admin/orders', '/api/admin/payments', '/api/admin/users', '/api/admin/settings', '/api/admin/lookups']) {
    it(`GET ${route}`, async () => {
      expect((await guest(route)).status).toBe(401)
      expect((await customer(route)).status).toBe(403)
      expect((await affiliate(route)).status).toBe(403)
      expect((await admin(route)).status).toBe(200)
    })
  }
  it('admin sees the draft book; the list is DB-backed', async () => {
    const list = await (await admin('/api/admin/books')).json()
    expect(JSON.stringify(list)).toContain(`${FIXTURE_TITLE_PREFIX}draft`)
  })
})

describe('admin CRUD on hosted (categories, makers) incl. validation, soft delete, restore, audit', () => {
  it('categories', async () => {
    expect((await admin('/api/admin/categories', { method: 'POST', json: { name: '  ' } })).status).toBe(400)
    const created = await admin('/api/admin/categories', { method: 'POST', json: { name: `${FIXTURE_TITLE_PREFIX}cat`, is_active: true } })
    expect(created.status).toBe(201)
    const id = (await created.json()).id as number
    expect((await customer(`/api/admin/categories/${id}`, { method: 'DELETE' })).status).toBe(403)
    expect((await admin(`/api/admin/categories/${id}`, { method: 'PUT', json: { name: `${FIXTURE_TITLE_PREFIX}cat2`, is_active: true } })).status).toBe(200)
    expect((await admin(`/api/admin/categories/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await svc.from('categories').select('deleted_at').eq('id', id).single()).data!.deleted_at).not.toBeNull()
    expect((await admin(`/api/admin/categories/${id}/restore`, { method: 'POST' })).status).toBe(200)
    expect((await svc.from('categories').select('deleted_at').eq('id', id).single()).data!.deleted_at).toBeNull()
    const audit = await svc.from('audit_log').select('action,actor_id').eq('entity', 'categories').eq('entity_id', String(id)).eq('actor_id', boss.id)
    expect((audit.data ?? []).length).toBeGreaterThan(0)
  })
  it('makers: bio HTML is sanitised on save', async () => {
    const m = await admin('/api/admin/makers', { method: 'POST', json: { name: `${FIXTURE_TITLE_PREFIX}maker`, kind: 'author', era: 'new', bio_html: '<script>x</script><i>bio</i>' } })
    expect(m.status).toBe(201)
    const id = (await m.json()).id as number
    expect((await (await admin(`/api/admin/makers/${id}`)).json()).bio_html).toBe('<i>bio</i>')
  })
})

describe('customer account, cart and library', () => {
  it('cart prices come from the database; forged client prices are ignored', async () => {
    const res = await guest('/api/cart/quote', { method: 'POST', json: { bookIds: [paidBook, 987654321], items: [{ id: paidBook, price: 0.01 }], total: 0.01 } })
    expect(res.status).toBe(200)
    const q = await res.json()
    expect(q.total).toBe(7.5)
    expect(q.unavailable).toEqual([987654321])
  })
  it('downloads: preview open, free open, paid needs login then purchase, pending is 503, nothing leaks a path', async () => {
    const dl = (who: App, key: string) => who(`/api/library/download/${mediaIds[key]}`)
    const preview = await dl(guest, 'preview')
    expect(preview.status).toBe(302)
    expect(preview.headers.get('location')).toBe('https://example.invalid/preview.pdf')
    expect((await dl(guest, 'free')).status).toBe(302)
    expect((await dl(guest, 'paid')).status).toBe(401)
    expect((await dl(customer, 'paid')).status).toBe(403)          // logged in, no entitlement
    expect((await dl(admin, 'paid')).status).toBe(302)             // admins may fetch
    const pending = await dl(guest, 'pending')
    expect(pending.status).toBe(503)
    expect(JSON.stringify(await pending.json())).not.toMatch(/storage_path|books\//)
    expect((await guest('/api/library/download/987654321')).status).toBe(404)
  })
})

describe('payments are NOT active on hosted', () => {
  it('checkout is refused (simulator off, gateways not integrated) and no payment row is created', async () => {
    const before = (await svc.from('payments').select('id', { count: 'exact', head: true })).count
    const res = await customer('/api/checkout/session', { method: 'POST', json: { bookIds: [paidBook] } })
    expect([403, 501]).toContain(res.status)
    expect((await svc.from('payments').select('id', { count: 'exact', head: true })).count).toBe(before)
    expect((await guest('/api/checkout/session', { method: 'POST', json: { bookIds: [paidBook] } })).status).toBe(401)
    expect((await customer(`/api/checkout/simulate/${crypto.randomUUID()}`, { method: 'POST', json: { outcome: 'success' } })).status).not.toBe(200)
  })
  it('the webhook endpoint rejects unsigned or unknown-provider calls', async () => {
    for (const p of ['paymob', 'tap', 'dev_simulator', 'nope']) {
      const res = await guest(`/api/webhooks/payments/${p}`, { method: 'POST', json: { id: 'x' } })
      expect([400, 401, 403, 404, 501], p).toContain(res.status)
    }
    expect((await svc.from('payments').select('id', { count: 'exact', head: true })).count).toBe(0)
  })
})

describe('affiliate and contributor boundaries', () => {
  it('affiliate endpoints: guest 401, plain customer 403, affiliate 200', async () => {
    for (const route of ['/api/affiliate/summary', '/api/affiliate/books', '/api/affiliate/withdrawals']) {
      expect((await guest(route)).status, route).toBe(401)
      expect((await customer(route)).status, route).toBe(403)
      expect((await affiliate(route)).status, route).toBe(200)
    }
  })
  it('an affiliate cannot request a withdrawal above their (empty) balance, and nothing is written', async () => {
    const res = await affiliate('/api/affiliate/withdrawals', { method: 'POST', json: { amount: 500 } })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect((await svc.from('withdrawal_requests').select('id', { count: 'exact', head: true })).count).toBe(0)
    expect((await svc.from('affiliate_ledger').select('id', { count: 'exact', head: true })).count).toBe(0)
  })
  it('contributor submission needs a session and validates the form before touching storage', async () => {
    expect((await guest('/api/contributor/requests', { method: 'POST', json: {} })).status).toBe(401)
    const bad = await customer('/api/contributor/requests', { method: 'POST', json: {} })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    expect((await svc.from('contributor_requests').select('id', { count: 'exact', head: true })).count).toBe(0)
    expect((await guest('/api/contributor/books')).status).toBe(401)
  })
})
