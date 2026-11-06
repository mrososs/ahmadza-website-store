// RLS / role-separation / commerce-boundary checks for the HOSTED AAWRAQ project.
//   HOSTED_TEST_CONFIRM=ubjuyeccioflhpcpnhmo npm run test:hosted        (needs .env.hosted; see tests/hosted/helpers.ts for the safety rails)
// Mirrors the local suites (tests/db/rls*.test.ts) with self-created fixtures, because the hosted project has no seed data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, cleanupFixtures, createFixtureUser, FIXTURE_TITLE_PREFIX, rehearsal, rest, serviceClient, type Fixture } from './helpers'

const svc = serviceClient()
let alice: Fixture, bob: Fixture, admin: Fixture
let published = 0
let draft = 0

beforeAll(async () => {
  await cleanupFixtures(svc)
  ;[alice, bob, admin] = [await createFixtureUser(svc, 'alice'), await createFixtureUser(svc, 'bob'), await createFixtureUser(svc, 'admin')]
  await svc.from('user_roles').insert({ user_id: admin.id, role: 'admin' })
  const mk = async (suffix: string, status: 'published' | 'draft') => (await svc.from('books').insert({ title: `${FIXTURE_TITLE_PREFIX}${suffix}`, kind: 'paid', price_amount: 5, status }).select('id').single()).data!.id
  published = await mk('published', 'published')
  draft = await mk('draft', 'draft')
})
afterAll(async () => { await cleanupFixtures(svc) })

describe('anonymous visitor', () => {
  const anon = anonClient()
  it('sees published books only, never drafts', async () => {
    expect((await anon.from('books').select('id').eq('id', published)).data).toHaveLength(1)
    expect((await anon.from('books').select('id').eq('id', draft)).data).toHaveLength(0)
  })
  it('sees nothing in private tables', async () => {
    for (const t of ['orders', 'order_items', 'payments', 'payment_events', 'entitlements', 'affiliate_commissions', 'affiliate_ledger', 'withdrawal_requests',
      'payout_methods', 'profiles', 'user_roles', 'favourites', 'contact_messages', 'contributor_requests', 'audit_log']) {
      const r = await rest(`${t}?select=*&limit=1`, null)
      const body = await r.json().catch(() => null)
      expect(Array.isArray(body) ? body.length : 0, `${t} (HTTP ${r.status})`).toBe(0)
    }
  })
  it('cannot read protected columns (commercial settings, storage keys, owners, raw payment responses)', async () => {
    for (const q of ['books?select=owner_id&limit=1', 'book_media?select=storage_path&limit=1', 'book_media?select=sha256&limit=1', 'payments?select=raw_response&limit=1',
      'site_settings?select=affiliate_commission_percent&limit=1', 'site_settings?select=payment_mode&limit=1', 'site_settings?select=allow_test_payments&limit=1']) {
      expect([401, 403], q).toContain((await rest(q, null)).status)
    }
    expect((await rest('site_settings?select=site_name&limit=1', null)).status).toBe(200)
  })
  it('cannot write anything', async () => {
    for (const [m, p, body] of [['POST', 'books', { title: 'x', price_amount: 1, kind: 'paid', status: 'published' }], ['PATCH', `books?id=eq.${published}`, { title: 'x' }], ['DELETE', `books?id=eq.${published}`, undefined],
      ['POST', 'entitlements', { user_id: alice.id, book_id: published }], ['PATCH', 'site_settings?id=eq.1', { site_name: 'x' }], ['POST', 'user_roles', { user_id: alice.id, role: 'admin' }]] as const) {
      const r = await rest(p, null, { method: m, body: body === undefined ? undefined : JSON.stringify(body) })
      expect([401, 403], `${m} ${p}`).toContain(r.status)
    }
  })
  it('cannot call helper or money functions', async () => {
    const anon = anonClient()
    for (const fn of ['is_admin', 'is_affiliate']) expect((await anon.rpc(fn as never)).error, fn).not.toBeNull()
    for (const fn of ['fulfill_payment', 'create_payment_for_cart', 'request_withdrawal', 'purge_demo_data']) {
      expect([401, 403, 404], fn).toContain((await rest(`rpc/${fn}`, null, { method: 'POST', body: '{}' })).status)
    }
  })
})

describe('customer isolation', () => {
  it('a customer sees only their own profile, favourites and roles', async () => {
    expect((await alice.client.from('profiles').select('id')).data?.map((p) => p.id)).toEqual([alice.id])
    await alice.client.from('favourites').insert({ user_id: alice.id, book_id: published })
    expect((await bob.client.from('favourites').select('id')).data ?? []).toHaveLength(0)
    expect((await bob.client.from('favourites').insert({ user_id: alice.id, book_id: published })).error).not.toBeNull()
    expect((await alice.client.from('user_roles').select('user_id')).data ?? []).toHaveLength(0)
  })
  it('profile identity and privilege columns cannot be changed by the owner; harmless ones can', async () => {
    for (const patch of [{ id: bob.id }, { is_affiliate: true }, { status: 'active' }, { require_password_reset: false }, { legacy_user_id: 1 }]) {
      expect((await alice.client.from('profiles').update(patch as never).eq('id', alice.id)).error?.code, JSON.stringify(patch)).toBe('42501')
    }
    expect((await alice.client.from('profiles').update({ display_name: `${FIXTURE_TITLE_PREFIX}alice2` }).eq('id', alice.id)).error).toBeNull()
  })
  it('comments cannot be re-pointed or edited; books cannot be repriced by a customer', async () => {
    const { data: c } = await alice.client.from('comments').insert({ user_id: alice.id, book_id: published, body: 'hosted-test' }).select('id,status').single()
    expect(c?.status).toBe('pending')
    expect((await alice.client.from('comments').update({ user_id: bob.id }).eq('id', c!.id)).error?.code).toBe('42501')
    expect((await alice.client.from('books').update({ price_amount: 0.01, owner_id: alice.id } as never).eq('id', published)).error?.code).toBe('42501')
  })
})

describe('money, entitlements and roles are server-only', () => {
  it('a customer cannot grant a book, forge a payment, move ledger money, escalate to admin, or call fulfilment', async () => {
    const t = alice.accessToken
    const post = (p: string, b: unknown) => rest(p, t, { method: 'POST', body: JSON.stringify(b) })
    expect([401, 403]).toContain((await post('entitlements', { user_id: alice.id, book_id: published })).status)
    expect([401, 403]).toContain((await post('payments', { user_id: alice.id, provider: 'dev_simulator', amount: 1, currency: 'USD', cart_snapshot: [] })).status)
    expect([401, 403]).toContain((await post('orders', { user_id: alice.id, mode: 'live', total_amount: 0, currency: 'USD' })).status)
    expect([401, 403]).toContain((await post('affiliate_ledger', { affiliate_id: alice.id, entry_type: 'adjustment', amount: 100, currency: 'USD' })).status)
    expect([401, 403]).toContain((await post('user_roles', { user_id: alice.id, role: 'admin' })).status)
    expect([401, 403, 404]).toContain((await post('rpc/fulfill_payment', { p_payment_id: crypto.randomUUID(), p_provider_txn: 'x', p_amount: 1, p_currency: 'USD' })).status)
    expect((await svc.from('entitlements').select('id').eq('user_id', alice.id)).data).toHaveLength(0)
  })
  // meaningful on the hosted project only: the local stack intentionally enables the simulator
  it.skipIf(rehearsal)('the development payment simulator is OFF and live payments are not configured', async () => {
    const s = (await svc.from('site_settings').select('allow_test_payments,payment_mode').eq('id', 1).single()).data!
    expect(s.allow_test_payments).toBe(false)
  })
})

describe('administrator separation', () => {
  it('is_admin answers per caller; admin data is visible to admins only', async () => {
    expect((await admin.client.rpc('is_admin')).data).toBe(true)
    expect((await alice.client.rpc('is_admin')).data).toBe(false)
    expect((await admin.client.from('audit_log').select('id').limit(1)).error).toBeNull()
    expect((await alice.client.from('audit_log').select('id').limit(1)).data ?? []).toHaveLength(0)
    expect((await alice.client.from('user_roles').select('user_id').neq('user_id', alice.id)).data ?? []).toHaveLength(0)
    expect((await admin.client.from('books').select('id').eq('id', draft)).data).toHaveLength(1)   // drafts visible to admins
    expect((await alice.client.from('books').select('id').eq('id', draft)).data).toHaveLength(0)
  })
  it('an admin still cannot mutate money tables from the client (server-only paths)', async () => {
    const r = await rest('entitlements', admin.accessToken, { method: 'POST', body: JSON.stringify({ user_id: alice.id, book_id: published }) })
    expect([401, 403]).toContain(r.status)
  })
})

describe('payment_events and payout_methods', () => {
  it('payment_events is neither readable nor writable by anon, customer or admin (server-only)', async () => {
    const row = { provider: 'dev_simulator', event_id: `hosted-probe-${Date.now()}`, event_type: 'probe' }
    for (const [who, c] of [['anon', anonClient()], ['customer', alice.client], ['admin', admin.client]] as const) {
      expect((await c.from('payment_events').select('id').limit(1)).error?.code, `${who} select`).toBe('42501')
      expect((await c.from('payment_events').insert(row)).error?.code, `${who} insert`).toBe('42501')
      expect((await c.from('payment_events').update({ event_type: 'x' }).eq('id', 1)).error?.code, `${who} update`).toBe('42501')
      expect((await c.from('payment_events').delete().eq('id', 1)).error?.code, `${who} delete`).toBe('42501')
    }
  })
  it('payout_methods: own rows for affiliates only; customers see none; admins read all but cannot write', async () => {
    const carol = await createFixtureUser(svc, 'carol')
    await svc.from('profiles').update({ is_affiliate: true }).eq('id', carol.id)
    const mine = { affiliate_id: carol.id, kind: 'paypal', details: { email: 'carol@example.invalid' } }
    expect((await alice.client.from('payout_methods').insert({ ...mine, affiliate_id: alice.id })).error).not.toBeNull()   // not an affiliate
    expect((await carol.client.from('payout_methods').insert({ ...mine, affiliate_id: bob.id })).error).not.toBeNull()     // someone else's row
    const ins = await carol.client.from('payout_methods').insert(mine).select('id').single()
    expect(ins.error).toBeNull()
    expect((await carol.client.from('payout_methods').select('id')).data).toHaveLength(1)
    expect((await bob.client.from('payout_methods').select('id')).data ?? []).toHaveLength(0)
    expect((await alice.client.from('payout_methods').select('id')).data ?? []).toHaveLength(0)
    expect((await admin.client.from('payout_methods').select('id').eq('id', ins.data!.id)).data).toHaveLength(1)
    const moved = await carol.client.from('payout_methods').update({ affiliate_id: bob.id }).eq('id', ins.data!.id).select()
    expect(moved.error !== null || (moved.data ?? []).length === 0).toBe(true)
    const adminEdit = await admin.client.from('payout_methods').update({ details: { tampered: true } }).eq('id', ins.data!.id).select()
    expect(adminEdit.error !== null || (adminEdit.data ?? []).length === 0).toBe(true)
    expect((await svc.from('payout_methods').select('affiliate_id').eq('id', ins.data!.id).single()).data!.affiliate_id).toBe(carol.id)
  })
})

describe('Data API exposure', () => {
  it('the private schema and trigger functions are not callable', async () => {
    expect((await anonClient().rpc('is_public_book' as never, { p_book: published } as never)).error).not.toBeNull()
    for (const fn of ['handle_new_user', 'audit_row_change', 'touch_updated_at']) expect([401, 403, 404], fn).toContain((await rest(`rpc/${fn}`, alice.accessToken, { method: 'POST', body: '{}' })).status)
  })
})
