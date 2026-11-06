import { describe, expect, it } from 'vitest'
import { serviceClient, signedInClient } from '../helpers/supabase'
import { createTestUser, demoPaidBooks, tx } from '../helpers/commerce'

const admin = serviceClient()

describe('customer account data (RLS + column grants)', () => {
  it('profile update is limited to harmless columns', async () => {
    const u = await createTestUser()
    const { client } = await signedInClient(u.email)
    expect((await client.from('profiles').update({ display_name: 'اسم جديد', phone: '123' }).eq('id', u.id)).error).toBeNull()
    expect((await client.from('profiles').update({ is_affiliate: true }).eq('id', u.id)).error?.code).toBe('42501')
    expect((await client.from('profiles').update({ status: 'active' }).eq('id', u.id)).error?.code).toBe('42501')
    const row = (await admin.from('profiles').select('display_name,is_affiliate').eq('id', u.id).single()).data!
    expect(row).toEqual({ display_name: 'اسم جديد', is_affiliate: false })
  })

  it('favourites are private to their owner', async () => {
    const [book] = await demoPaidBooks(1)
    const a = await createTestUser(); const b = await createTestUser()
    const A = (await signedInClient(a.email)).client; const B = (await signedInClient(b.email)).client
    expect((await A.from('favourites').insert({ user_id: a.id, book_id: book!.id })).error).toBeNull()
    expect((await A.from('favourites').insert({ user_id: a.id, book_id: book!.id })).error).not.toBeNull() // no duplicates
    expect((await B.from('favourites').insert({ user_id: a.id, book_id: book!.id })).error).not.toBeNull() // cannot write for someone else
    expect((await B.from('favourites').select('id')).data).toHaveLength(0)
    const mine = (await A.from('favourites').select('id,books(title)')).data!
    expect(mine).toHaveLength(1)
    await B.from('favourites').delete().eq('id', mine[0]!.id)
    expect((await A.from('favourites').select('id')).data).toHaveLength(1)
    await A.from('favourites').delete().eq('id', mine[0]!.id)
    expect((await A.from('favourites').select('id')).data).toHaveLength(0)
  })

  it('library embeds only the owner\'s entitlement and invoice numbers come from orders.order_no', async () => {
    const [book] = await demoPaidBooks(1)
    const a = await createTestUser(); const b = await createTestUser()
    const p = (await admin.rpc('create_payment_for_cart', { p_user: a.id, p_book_ids: [book!.id], p_affiliate: null as never, p_provider: 'dev_simulator', p_mode: 'test' })).data as unknown as { id: string; amount: number; currency: string }
    await admin.rpc('fulfill_payment', { p_payment_id: p.id, p_provider_txn: tx(), p_amount: Number(p.amount), p_currency: p.currency })
    const A = (await signedInClient(a.email)).client; const B = (await signedInClient(b.email)).client
    const lib = (await A.from('entitlements').select('id,is_test,books(id,title)').is('revoked_at', null)).data!
    expect(lib).toHaveLength(1)
    expect(lib[0]!.is_test).toBe(true)
    const order = (await A.from('orders').select('order_no,order_items(title_snapshot,unit_price)')).data!
    expect(order).toHaveLength(1)
    expect(order[0]!.order_no).toBeGreaterThan(0)
    expect((await B.from('orders').select('order_no').eq('order_no', order[0]!.order_no)).data).toHaveLength(0)
  })
})
