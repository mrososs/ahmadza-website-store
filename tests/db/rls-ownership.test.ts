// Ownership-reassignment, direct-REST and function-privilege tests (run against the LOCAL stack; the same file is
// meant to be re-run against the hosted AAWRAQ project once it is authorised — see docs/implementation/HOSTED_SUPABASE_SETUP.md).
import { beforeAll, describe, expect, it } from 'vitest'
import { anonClient, DEV_USERS, serviceClient, signedInClient, SUPABASE_URL } from '../helpers/supabase'
import { readFileSync } from 'node:fs'

const svc = serviceClient()
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const KEY = env.NUXT_PUBLIC_SUPABASE_KEY!

let customer: Awaited<ReturnType<typeof signedInClient>>
let customer2: Awaited<ReturnType<typeof signedInClient>>
let affiliate: Awaited<ReturnType<typeof signedInClient>>
let admin: Awaited<ReturnType<typeof signedInClient>>
let bookId: number

const rest = (path: string, token: string | null, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${token ?? KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers as Record<string, string>) } })

beforeAll(async () => {
  ;[customer, customer2, affiliate, admin] = await Promise.all([
    signedInClient(DEV_USERS.customer), signedInClient(DEV_USERS.customer2), signedInClient(DEV_USERS.affiliate), signedInClient(DEV_USERS.admin),
  ])
  bookId = (await svc.from('books').select('id').eq('status', 'published').eq('kind', 'paid').limit(1).single()).data!.id
})

describe('ownership reassignment is impossible', () => {
  it('a comment cannot be re-pointed at another user or edited at all (no UPDATE grant)', async () => {
    const { data: c } = await customer.client.from('comments').insert({ user_id: customer.userId, book_id: bookId, body: 'own-test' }).select('id').single()
    const r = await customer.client.from('comments').update({ user_id: customer2.userId }).eq('id', c!.id)
    expect(r.error?.code).toBe('42501')
    await svc.from('comments').delete().eq('id', c!.id)
  })

  it('a favourite cannot be reassigned or inserted for someone else', async () => {
    await svc.from('favourites').delete().eq('user_id', customer.userId)
    const { data: f } = await customer.client.from('favourites').insert({ user_id: customer.userId, book_id: bookId }).select('id').single()
    expect((await customer.client.from('favourites').update({ user_id: customer2.userId } as never).eq('id', f!.id)).error?.code).toBe('42501')
    expect((await customer.client.from('favourites').insert({ user_id: customer2.userId, book_id: bookId })).error).not.toBeNull()
    await svc.from('favourites').delete().eq('user_id', customer.userId)
  })

  it('payout methods cannot be moved to another affiliate (WITH CHECK)', async () => {
    const { data: pm } = await affiliate.client.from('payout_methods').select('id').limit(1).single()
    const moved = await affiliate.client.from('payout_methods').update({ affiliate_id: customer.userId }).eq('id', pm!.id).select()
    expect(moved.error !== null || (moved.data ?? []).length === 0).toBe(true)
    const stillMine = await svc.from('payout_methods').select('affiliate_id').eq('id', pm!.id).single()
    expect(stillMine.data!.affiliate_id).toBe(affiliate.userId)
  })

  it('profile identity / role columns cannot be changed by the owner', async () => {
    for (const patch of [{ id: customer2.userId }, { is_affiliate: true }, { status: 'active' }, { require_password_reset: false }, { legacy_user_id: 1 }]) {
      const r = await customer.client.from('profiles').update(patch as never).eq('id', customer.userId)
      expect(r.error?.code, JSON.stringify(patch)).toBe('42501')
    }
  })

  it('books: an owner/contributor cannot change price, status or ownership (no UPDATE grant)', async () => {
    for (const c of [customer, affiliate]) {
      const r = await c.client.from('books').update({ price_amount: 0.01, owner_id: c.userId } as never).eq('id', bookId)
      expect(r.error?.code).toBe('42501')
    }
  })
})

describe('direct PostgREST access (raw HTTP, no SDK)', () => {
  it('anonymous: published books yes; private rows and columns no', async () => {
    expect((await rest('books?select=id,title&limit=1', null)).status).toBe(200)
    expect(((await (await rest('orders?select=id', null)).json()) as unknown[]).length ?? 0).toBe(0)
    expect((await rest('books?select=owner_id&limit=1', null)).status).toBe(401)
    expect((await rest('book_media?select=storage_path&limit=1', null)).status).toBe(401)
    expect((await rest('payments?select=raw_response&limit=1', null)).status).toBe(401)
  })

  it('anonymous cannot POST/PATCH/DELETE anything (valid payloads, so the denial is a permission error)', async () => {
    const uid = customer.userId
    const cases: [string, string, unknown][] = [
      ['POST', 'books', { title: 'x', price_amount: 1, kind: 'paid', status: 'published' }],
      ['PATCH', 'books?id=eq.1', { title: 'x' }],
      ['DELETE', 'books?id=eq.1', undefined],
      ['POST', 'orders', { user_id: uid, mode: 'live', total_amount: 0, currency: 'USD' }],
      ['POST', 'entitlements', { user_id: uid, book_id: bookId }],
      ['PATCH', 'site_settings?id=eq.1', { site_name: 'x' }],
    ]
    for (const [m, p, body] of cases) {
      const r = await rest(p, null, { method: m, body: body === undefined ? undefined : JSON.stringify(body) })
      expect([401, 403], `${m} ${p} -> ${r.status}`).toContain(r.status)
    }
  })

  it('a customer cannot grant themselves a book, forge a payment or move money over REST', async () => {
    const tok = customer.accessToken
    expect([401, 403]).toContain((await rest('entitlements', tok, { method: 'POST', body: JSON.stringify({ user_id: customer.userId, book_id: bookId }) })).status)
    expect([401, 403]).toContain((await rest('payments', tok, { method: 'POST', body: JSON.stringify({ user_id: customer.userId, provider: 'dev_simulator', amount: 1, currency: 'USD', cart_snapshot: [] }) })).status)
    expect([401, 403]).toContain((await rest('affiliate_ledger', tok, { method: 'POST', body: JSON.stringify({ affiliate_id: customer.userId, entry_type: 'adjustment', amount: 100, currency: 'USD' }) })).status)
    const rpc = await rest('rpc/fulfill_payment', tok, { method: 'POST', body: JSON.stringify({ p_payment_id: crypto.randomUUID(), p_provider_txn: 'x', p_amount: 1, p_currency: 'USD' }) })
    expect([401, 403, 404]).toContain(rpc.status)
  })

  it('the private schema is not exposed through the Data API', async () => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_public_book`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json', 'content-profile': 'private' }, body: JSON.stringify({ p_book: bookId }) })
    expect([400, 404, 406]).toContain(r.status)
    expect((await anonClient().rpc('is_public_book' as never, { p_book: bookId } as never)).error).not.toBeNull()
  })
})

describe('function privileges', () => {
  const anon = anonClient()
  it('helper functions are not callable by anonymous visitors', async () => {
    for (const fn of ['is_admin', 'is_affiliate']) expect((await anon.rpc(fn as never)).error, fn).not.toBeNull()
    expect((await anon.rpc('owns_book', { p_book: bookId })).error).not.toBeNull()
  })
  it('administrator-only data stays hidden from customers and affiliates', async () => {
    for (const c of [customer, affiliate]) {
      expect((await c.client.from('audit_log').select('id').limit(1)).data ?? []).toHaveLength(0)
      expect((await c.client.from('user_roles').select('user_id').neq('user_id', c.userId)).data ?? []).toHaveLength(0)
      expect((await c.client.from('legacy_media_staging').select('id').limit(1)).data ?? []).toHaveLength(0)
    }
    expect((await admin.client.from('audit_log').select('id').limit(1)).error).toBeNull()
  })
})
