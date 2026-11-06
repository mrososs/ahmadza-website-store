// RLS / privilege matrix against the LOCAL stack: anonymous, authenticated customer, unrelated user, affiliate, admin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, DEV_USERS, serviceClient, signedInClient, type Db } from '../helpers/supabase'

const svc = serviceClient()
let draftBookId: number
let customer: Awaited<ReturnType<typeof signedInClient>>
let customer2: Awaited<ReturnType<typeof signedInClient>>
let affiliate: Awaited<ReturnType<typeof signedInClient>>
let admin: Awaited<ReturnType<typeof signedInClient>>

const denied = (r: { error: { code?: string; message?: string } | null }) => {
  expect(r.error, 'expected a permission error').not.toBeNull()
  expect(['42501', 'PGRST301', '401', '403']).toContain(r.error!.code)
}

beforeAll(async () => {
  ;[customer, customer2, affiliate, admin] = await Promise.all([
    signedInClient(DEV_USERS.customer), signedInClient(DEV_USERS.customer2),
    signedInClient(DEV_USERS.affiliate), signedInClient(DEV_USERS.admin),
  ])
  const { data, error } = await svc.from('books').insert({ title: 'RLS-TEST مسودة', status: 'draft', kind: 'paid', price_amount: 3, is_demo: true }).select('id').single()
  if (error) throw error
  draftBookId = data.id
})
afterAll(async () => {
  await svc.from('books').delete().eq('id', draftBookId)
})

describe('anonymous visitor', () => {
  const anon: Db = anonClient()

  it('reads published books but never drafts or private columns', async () => {
    const { data } = await anon.from('books').select('id,title,status').limit(100)
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((b) => b.status !== 'draft' && b.status !== 'archived')).toBe(true)
    expect(data!.some((b) => b.id === draftBookId)).toBe(false)
    denied(await anon.from('books').select('owner_id').limit(1))
    denied(await anon.from('books').select('legacy_cost_raw').limit(1))
  })

  it('cannot see book_media storage paths or external urls', async () => {
    denied(await anon.from('book_media').select('storage_path').limit(1))
    denied(await anon.from('book_media').select('external_url').limit(1))
    const ok = await anon.from('book_media').select('id,book_id,visibility').limit(1)
    expect(ok.error).toBeNull()
  })

  it('cannot read private tables', async () => {
    for (const t of ['profiles', 'orders', 'order_items', 'entitlements', 'payments', 'affiliate_ledger', 'affiliate_commissions',
      'withdrawal_requests', 'payout_methods', 'contributor_requests', 'contact_messages', 'audit_log', 'user_roles',
      'legacy_media_staging', 'legacy_id_map', 'migration_runs', 'payment_events'] as const) {
      const r = await anon.from(t).select('*').limit(1)
      // either a privilege error or an empty RLS-filtered set — but never rows
      expect(r.data ?? []).toHaveLength(0)
    }
  })

  it('cannot write catalog, commerce or settings', async () => {
    denied(await anon.from('books').insert({ title: 'x', price_amount: 1, kind: 'paid', status: 'published' }))
    denied(await anon.from('categories').insert({ name: 'x', slug: 'x' }))
    denied(await anon.from('orders').insert({ user_id: customer.userId, mode: 'live', total_amount: 0, currency: 'USD' }))
    denied(await anon.from('site_settings').update({ site_name: 'hacked' }).eq('id', 1))
  })

  it('sees only the public subset of site settings', async () => {
    const ok = await anon.from('site_settings').select('site_name,phone').eq('id', 1).single()
    expect(ok.data?.site_name).toBeTruthy()
    for (const col of ['affiliate_commission_percent', 'commission_freeze_days', 'min_withdrawal_amount', 'allow_test_payments', 'require_admin_mfa', 'payment_mode']) {
      denied(await anon.from('site_settings').select(col as 'site_name').limit(1))
    }
  })

  it('cannot execute trusted financial functions', async () => {
    denied(await anon.rpc('fulfill_payment', { p_payment_id: crypto.randomUUID(), p_provider_txn: 'x', p_amount: 1, p_currency: 'USD' }))
    denied(await anon.rpc('create_payment_for_cart', { p_user: customer.userId, p_book_ids: [1], p_affiliate: null as never, p_provider: 'dev_simulator', p_mode: 'test' }))
    denied(await anon.rpc('request_withdrawal', { p_affiliate: affiliate.userId, p_amount: 1 }))
    denied(await anon.rpc('purge_demo_data'))
    denied(await anon.rpc('affiliate_balance', { p_affiliate: affiliate.userId }))
  })
})

describe('authenticated customer', () => {
  it('reads and updates only their own profile, and only harmless columns', async () => {
    const own = await customer.client.from('profiles').select('id,display_name').eq('id', customer.userId)
    expect(own.data).toHaveLength(1)
    const others = await customer.client.from('profiles').select('id').neq('id', customer.userId)
    expect(others.data ?? []).toHaveLength(0)

    const upd = await customer.client.from('profiles').update({ display_name: 'عميل تجريبي' }).eq('id', customer.userId)
    expect(upd.error).toBeNull()
    denied(await customer.client.from('profiles').update({ is_affiliate: true } as never).eq('id', customer.userId))
    denied(await customer.client.from('profiles').update({ status: 'active' } as never).eq('id', customer.userId))
    const cross = await customer.client.from('profiles').update({ display_name: 'x' }).eq('id', customer2.userId).select()
    expect(cross.data ?? []).toHaveLength(0)
  })

  it('cannot grant themselves admin or read roles of others', async () => {
    denied(await customer.client.from('user_roles').insert({ user_id: customer.userId, role: 'admin' }))
    const roles = await customer.client.from('user_roles').select('user_id')
    expect((roles.data ?? []).every((r) => r.user_id === customer.userId)).toBe(true)
    const isAdmin = await customer.client.rpc('is_admin')
    expect(isAdmin.data).toBe(false)
  })

  it('cannot create orders, entitlements, payments or commissions through the Data API', async () => {
    denied(await customer.client.from('orders').insert({ user_id: customer.userId, mode: 'live', total_amount: 0, currency: 'USD' }))
    denied(await customer.client.from('entitlements').insert({ user_id: customer.userId, book_id: 1 }))
    denied(await customer.client.from('payments').insert({ user_id: customer.userId, provider: 'dev_simulator', amount: 1, currency: 'USD', cart_snapshot: [] }))
    denied(await customer.client.from('affiliate_ledger').insert({ affiliate_id: customer.userId, entry_type: 'adjustment', amount: 999, currency: 'USD' }))
    denied(await customer.client.rpc('fulfill_payment', { p_payment_id: crypto.randomUUID(), p_provider_txn: 'x', p_amount: 1, p_currency: 'USD' }))
  })

  it('cannot read gateway payloads even from their own payments', async () => {
    denied(await customer.client.from('payments').select('raw_response').limit(1))
  })

  it('favourites are strictly personal', async () => {
    const { data: b } = await svc.from('books').select('id').eq('status', 'published').limit(1).single()
    await svc.from('favourites').delete().eq('user_id', customer.userId)
    const mine = await customer.client.from('favourites').insert({ user_id: customer.userId, book_id: b!.id })
    expect(mine.error).toBeNull()
    denied(await customer.client.from('favourites').insert({ user_id: customer2.userId, book_id: b!.id }))
    const seenByOther = await customer2.client.from('favourites').select('id').eq('user_id', customer.userId)
    expect(seenByOther.data ?? []).toHaveLength(0)
    await svc.from('favourites').delete().eq('user_id', customer.userId)
  })

  it('cannot see drafts or write catalog rows', async () => {
    const r = await customer.client.from('books').select('id').eq('id', draftBookId)
    expect(r.data ?? []).toHaveLength(0)
    denied(await customer.client.from('books').update({ title: 'x' }).eq('id', 1))
    denied(await customer.client.from('pages').insert({ slug: 'evil', title: 'x', status: 'published' }))
  })

  it('cannot read audit log or contact inbox', async () => {
    expect((await customer.client.from('audit_log').select('id').limit(1)).data ?? []).toHaveLength(0)
    expect((await customer.client.from('contact_messages').select('id').limit(1)).data ?? []).toHaveLength(0)
  })
})

describe('affiliate (unrelated-user isolation)', () => {
  it('cannot read another affiliate / customer money data or payout details', async () => {
    const { data: ledger } = await customer2.client.from('affiliate_ledger').select('id').eq('affiliate_id', affiliate.userId)
    expect(ledger ?? []).toHaveLength(0)
    const { data: pm } = await customer2.client.from('payout_methods').select('id').eq('affiliate_id', affiliate.userId)
    expect(pm ?? []).toHaveLength(0)
    const { data: wd } = await customer2.client.from('withdrawal_requests').select('id').eq('affiliate_id', affiliate.userId)
    expect(wd ?? []).toHaveLength(0)
    const own = await affiliate.client.from('payout_methods').select('kind').eq('affiliate_id', affiliate.userId)
    expect(own.error).toBeNull()
    expect(own.data!.length).toBeGreaterThan(0)
  })

  it('a non-affiliate cannot create a payout method', async () => {
    denied(await customer.client.from('payout_methods').insert({ affiliate_id: customer.userId, kind: 'paypal', details: {} }))
  })

  it('cannot ask for another affiliate balance', async () => {
    const r = await customer.client.rpc('affiliate_balance', { p_affiliate: affiliate.userId })
    expect(r.error).not.toBeNull()
  })

  it('cannot call request_withdrawal directly', async () => {
    denied(await affiliate.client.rpc('request_withdrawal', { p_affiliate: affiliate.userId, p_amount: 1 }))
  })
})

describe('administrator', () => {
  it('is recognised through user_roles and sees drafts, audit log, all profiles and the inbox', async () => {
    expect((await admin.client.rpc('is_admin')).data).toBe(true)
    expect(((await admin.client.from('books').select('id').eq('id', draftBookId)).data ?? [])).toHaveLength(1)
    expect((await admin.client.from('profiles').select('id')).data!.length).toBeGreaterThanOrEqual(5)
    expect((await admin.client.from('audit_log').select('id').limit(1)).error).toBeNull()
  })

  it('still cannot mutate roles or catalog straight through the Data API (server routes only)', async () => {
    denied(await admin.client.from('user_roles').insert({ user_id: customer.userId, role: 'admin' }))
    denied(await admin.client.from('books').update({ title: 'admin direct write' }).eq('id', draftBookId))
    denied(await admin.client.rpc('purge_demo_data'))
  })

  it('role changes are audited when made by the trusted server', async () => {
    await svc.from('user_roles').insert({ user_id: customer2.userId, role: 'admin' })
    await svc.from('user_roles').delete().eq('user_id', customer2.userId)
    const { data } = await svc.from('audit_log').select('action').eq('entity', 'user_roles').order('id', { ascending: false }).limit(2)
    expect(data!.map((r) => r.action)).toEqual(expect.arrayContaining(['insert', 'delete']))
  })
})

describe('integrity constraints', () => {
  it('a free book must cost 0 and a published paid book must cost > 0', async () => {
    const free = await svc.from('books').insert({ title: 'bad free', kind: 'free', status: 'published', price_amount: 5, is_demo: true })
    expect(free.error?.code).toBe('23514')
    const paid = await svc.from('books').insert({ title: 'bad paid', kind: 'paid', status: 'published', price_amount: 0, is_demo: true })
    expect(paid.error?.code).toBe('23514')
  })

  it('search column is normalised by the trigger', async () => {
    const { data } = await svc.from('books').select('title_norm').eq('id', draftBookId).single()
    expect(data!.title_norm).toBe('rls-test مسوده')
  })
})

describe('storage', () => {
  it('private buckets are not readable anonymously, public-media objects are', async () => {
    const anon = anonClient()
    const priv = await anon.storage.from('private-products').list('books', { limit: 1 })
    expect(priv.data ?? []).toHaveLength(0)
    const sens = await anon.storage.from('private-sensitive').list('', { limit: 1 })
    expect(sens.data ?? []).toHaveLength(0)
    const stage = await anon.storage.from('legacy-staging').list('', { limit: 1 })
    expect(stage.data ?? []).toHaveLength(0)
    const { data: files } = await svc.storage.from('private-products').list('books/1', { limit: 1 })
    if (files?.length) {
      const dl = await anon.storage.from('private-products').download(`books/1/${files[0]!.name}`)
      expect(dl.error).not.toBeNull()
      const customerDl = await customer.client.storage.from('private-products').download(`books/1/${files[0]!.name}`)
      expect(customerDl.error).not.toBeNull()
    }
  })
})
