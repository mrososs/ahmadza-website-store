// Migrations 16–17: payment_events stays server-only; payout_methods keeps exactly the same access after the policy merge.
import { beforeAll, describe, expect, it } from 'vitest'
import { anonClient, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'

const svc = serviceClient()
let customer: Awaited<ReturnType<typeof signedInClient>>
let affiliate: Awaited<ReturnType<typeof signedInClient>>
let admin: Awaited<ReturnType<typeof signedInClient>>

beforeAll(async () => {
  ;[customer, affiliate, admin] = await Promise.all([signedInClient(DEV_USERS.customer), signedInClient(DEV_USERS.affiliate), signedInClient(DEV_USERS.admin)])
})

describe('payment_events is invisible and immutable for every non-service identity', () => {
  it('anonymous, customer, affiliate and admin can neither read nor write it', async () => {
    const row = { provider: 'dev_simulator', event_id: `probe-${Date.now()}`, event_type: 'probe' }
    for (const [who, c] of [['anon', anonClient()], ['customer', customer.client], ['affiliate', affiliate.client], ['admin', admin.client]] as const) {
      expect((await c.from('payment_events').select('id').limit(1)).error?.code, `${who} select`).toBe('42501')
      expect((await c.from('payment_events').insert(row)).error?.code, `${who} insert`).toBe('42501')
      expect((await c.from('payment_events').update({ event_type: 'x' }).eq('id', 1)).error?.code, `${who} update`).toBe('42501')
      expect((await c.from('payment_events').delete().eq('id', 1)).error?.code, `${who} delete`).toBe('42501')
    }
  })
  it('only the trusted function path writes events (service role)', async () => {
    const id = `probe-${Date.now()}`
    expect((await svc.from('payment_events').insert({ provider: 'dev_simulator', event_id: id, event_type: 'probe' })).error).toBeNull()
    await svc.from('payment_events').delete().eq('event_id', id)
  })
})

describe('payout_methods after the single-SELECT-policy merge', () => {
  it('an affiliate reads only their own method; a customer reads none; an admin reads all', async () => {
    const own = await affiliate.client.from('payout_methods').select('id,affiliate_id')
    expect(own.error).toBeNull()
    expect((own.data ?? []).length).toBeGreaterThan(0)
    expect((own.data ?? []).every((r) => r.affiliate_id === affiliate.userId)).toBe(true)
    expect((await customer.client.from('payout_methods').select('id')).data ?? []).toHaveLength(0)
    const all = await svc.from('payout_methods').select('id')
    expect(((await admin.client.from('payout_methods').select('id')).data ?? []).length).toBe((all.data ?? []).length)
  })

  it('writes stay own-row, affiliate-only: customers and admins cannot insert, affiliates cannot insert for others or move rows', async () => {
    const row = (id: string, kind = 'paypal') => ({ affiliate_id: id, kind, details: { email: 'x@example.invalid' } })
    expect((await customer.client.from('payout_methods').insert(row(customer.userId))).error).not.toBeNull()
    expect((await admin.client.from('payout_methods').insert(row(admin.userId))).error).not.toBeNull()
    expect((await affiliate.client.from('payout_methods').insert(row(customer.userId, 'bank_transfer'))).error).not.toBeNull()
    const mine = (await affiliate.client.from('payout_methods').select('id').limit(1).single()).data!
    const moved = await affiliate.client.from('payout_methods').update({ affiliate_id: customer.userId }).eq('id', mine.id).select()
    expect(moved.error !== null || (moved.data ?? []).length === 0).toBe(true)
    expect((await svc.from('payout_methods').select('affiliate_id').eq('id', mine.id).single()).data!.affiliate_id).toBe(affiliate.userId)
    // an admin cannot edit or delete an affiliate's payout details either (read-only for admins)
    const upd = await admin.client.from('payout_methods').update({ details: { tampered: true } }).eq('id', mine.id).select()
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
    const del = await admin.client.from('payout_methods').delete().eq('id', mine.id).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    expect((await svc.from('payout_methods').select('id').eq('id', mine.id)).data).toHaveLength(1)
  })
})
