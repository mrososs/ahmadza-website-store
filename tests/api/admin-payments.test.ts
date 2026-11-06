// Admin payments reconciliation endpoint. Run against the dev server (TEST_APP_URL) + LOCAL Supabase.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiAs, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'

type Api = Awaited<ReturnType<typeof apiAs>>
let guest: Api, customer: Api, affiliate: Api, admin: Api
const db = serviceClient()
const created: string[] = []
let ref = ''
let userId = ''

beforeAll(async () => {
  ;[guest, customer, affiliate, admin] = await Promise.all([apiAs(null), apiAs(DEV_USERS.customer), apiAs(DEV_USERS.affiliate), apiAs(DEV_USERS.admin)])
  userId = (await signedInClient(DEV_USERS.customer)).userId
  const stale = await db.from('payments').insert({
    user_id: userId, provider: 'dev_simulator', mode: 'test', amount: 12.5, currency: 'USD', status: 'pending',
    cart_snapshot: [], raw_response: { secret: 'must-never-leave-the-database' }, expires_at: new Date(Date.now() - 3600_000).toISOString(),
  }).select('id,reference').single()
  created.push(stale.data!.id); ref = stale.data!.reference
})
afterAll(async () => { if (created.length) await db.from('payments').delete().in('id', created) })

describe('GET /api/admin/payments', () => {
  it('401 guest / 403 customer+affiliate / 200 admin', async () => {
    expect((await guest('/api/admin/payments')).status).toBe(401)
    expect((await customer('/api/admin/payments')).status).toBe(403)
    expect((await affiliate('/api/admin/payments')).status).toBe(403)
    expect((await admin('/api/admin/payments')).status).toBe(200)
  })

  it('lists by exact reference, flags an abandoned pending payment, and never returns raw_response', async () => {
    const res = await admin(`/api/admin/payments?q=${ref}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ reference: ref, status: 'pending', provider: 'dev_simulator', mode: 'test', stale: true, order_no: null, events: 0 })
    expect(JSON.stringify(body)).not.toMatch(/raw_response|must-never-leave/)
  })

  it('filters by status / provider / mode and rejects unknown values', async () => {
    const pendingList = await (await admin('/api/admin/payments?status=pending&provider=dev_simulator&mode=test')).json()
    expect(pendingList.items.some((p: { reference: string }) => p.reference === ref)).toBe(true)
    const succeeded = await (await admin(`/api/admin/payments?status=succeeded&q=${ref}`)).json()
    expect(succeeded.total).toBe(0)
    expect((await admin('/api/admin/payments?status=bogus')).status).toBe(400)
    expect((await admin('/api/admin/payments?provider=stripe')).status).toBe(400)
  })

  it('search terms are exact lookups: wildcard / injection-shaped input returns nothing, not an error or everything', async () => {
    for (const q of ['%', '_', "' or 1=1 --", '*', 'a,b)or(status.eq.pending']) {
      const res = await admin(`/api/admin/payments?q=${encodeURIComponent(q)}`)
      expect(res.status, q).toBe(200)
      expect((await res.json()).total, q).toBe(0)
    }
  })
})
