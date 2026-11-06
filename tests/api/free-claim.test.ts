// Free-book access: a distinct, server-validated claim into the library. It never creates an order, payment, invoice or commission.
// Runs against the dev server (TEST_APP_URL) + LOCAL dev Supabase. Fixture books are tagged, demo-flagged and removed afterwards.
import { afterAll, describe, expect, it } from 'vitest'
import { apiAs, serviceClient } from '../helpers/supabase'
import { createTestUser, demoPaidBooks } from '../helpers/commerce'

const svc = serviceClient()
const TAG = '[free-claim-test] '
const made: number[] = []

async function book(over: Record<string, unknown> = {}) {
  const row = { title: `${TAG}${made.length + 1}`, kind: 'free', status: 'published', price_amount: 0, is_demo: true, provenance: 'demo', ...over }
  const { data, error } = await svc.from('books').insert(row as never).select('id').single()
  if (error) throw new Error(error.message)
  made.push(data.id)
  return data.id as number
}
afterAll(async () => { if (made.length) await svc.from('books').delete().in('id', made) })

const counts = async (userId: string) => ({
  orders: (await svc.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', userId)).count,
  payments: (await svc.from('payments').select('id', { count: 'exact', head: true }).eq('user_id', userId)).count,
  ent: (await svc.from('entitlements').select('id,source,order_item_id,is_test').eq('user_id', userId)).data ?? [],
})

describe('claiming a free book', () => {
  it('adds it to the library as a free claim: no order, no payment, no order item, never flagged test', async () => {
    const u = await createTestUser(); const api = await apiAs(u.email)
    const id = await book()
    const r = await api('/api/library/claim', { method: 'POST', json: { bookId: id } })
    expect(r.status).toBe(200)
    expect((await r.json()).claimed).toBe(true)
    const c = await counts(u.id)
    expect(c.orders).toBe(0)
    expect(c.payments).toBe(0)
    expect(c.ent).toEqual([expect.objectContaining({ source: 'free_claim', order_item_id: null, is_test: false })])
  })
  it('claiming twice is harmless and reports that nothing new was added', async () => {
    const u = await createTestUser(); const api = await apiAs(u.email)
    const id = await book()
    await api('/api/library/claim', { method: 'POST', json: { bookId: id } })
    const again = await api('/api/library/claim', { method: 'POST', json: { bookId: id } })
    expect(again.status).toBe(200)
    expect((await again.json()).claimed).toBe(false)
    expect((await counts(u.id)).ent).toHaveLength(1)
  })
  it('an administrator\'s revocation is never undone by claiming again', async () => {
    const u = await createTestUser(); const api = await apiAs(u.email)
    const id = await book()
    await api('/api/library/claim', { method: 'POST', json: { bookId: id } })
    await svc.from('entitlements').update({ revoked_at: new Date().toISOString() }).eq('user_id', u.id).eq('book_id', id)
    await api('/api/library/claim', { method: 'POST', json: { bookId: id } })
    expect((await svc.from('entitlements').select('revoked_at').eq('user_id', u.id).eq('book_id', id).single()).data?.revoked_at).not.toBeNull()
  })
  it('refuses a paid book, a draft, a deleted book, a free book that carries a price, and a book that does not exist', async () => {
    const u = await createTestUser(); const api = await apiAs(u.email)
    const [paid] = await demoPaidBooks(1)
    const draft = await book({ status: 'draft' })
    const deleted = await book({ deleted_at: new Date().toISOString() })
    for (const id of [paid!.id, draft, deleted, 999999999]) {
      expect((await api('/api/library/claim', { method: 'POST', json: { bookId: id } })).status, String(id)).toBe(409)
    }
    expect((await counts(u.id)).ent).toHaveLength(0)
    // the database itself also refuses a "free" book with a price (cannot even be created)
    expect((await svc.from('books').insert({ title: `${TAG}priced`, kind: 'free', status: 'published', price_amount: 5, is_demo: true, provenance: 'demo' } as never)).error).toBeTruthy()
  })
  it('needs a signed-in customer and a valid body; the database function cannot be called from the browser', async () => {
    const guest = await apiAs(null)
    expect((await guest('/api/library/claim', { method: 'POST', json: { bookId: 1 } })).status).toBe(401)
    const u = await createTestUser(); const api = await apiAs(u.email)
    expect((await api('/api/library/claim', { method: 'POST', json: { bookId: 'x' } })).status).toBe(400)
    expect((await api('/api/library/claim', { method: 'POST', json: {} })).status).toBe(400)
    const { signedInClient } = await import('../helpers/supabase')
    const { client } = await signedInClient(u.email)
    expect((await client.rpc('claim_free_book' as never, { p_user: u.id, p_book: 1 } as never)).error).toBeTruthy()
  })
  it('a suspended account cannot claim', async () => {
    const u = await createTestUser({ status: 'banned' }); const api = await apiAs(u.email)
    const id = await book()
    expect([401, 403]).toContain((await api('/api/library/claim', { method: 'POST', json: { bookId: id } })).status)
    expect((await counts(u.id)).ent).toHaveLength(0)
  })
  it('a claimed free book can then be downloaded through the same authorised route as before (open to the owner)', async () => {
    const u = await createTestUser(); const api = await apiAs(u.email)
    const id = await book()
    await api('/api/library/claim', { method: 'POST', json: { bookId: id } })
    const { data } = await svc.from('book_media').insert({ book_id: id, name: `${TAG}file`, visibility: 'after_purchase', migration_status: 'pending' } as never).select('id').single()
    const dl = await api(`/api/library/download/${data!.id}`)
    expect([302, 404, 503]).toContain(dl.status) // never 200 with content; a pending file answers "being prepared" (503) rather than a fake URL
    expect(dl.status).toBe(503)
    // the attempt is on the audit trail: who, which file, what happened (no IP, no path)
    const log = (await svc.from('media_download_log').select('outcome,user_id,media_id').eq('media_id', data!.id)).data ?? []
    expect(log).toEqual([expect.objectContaining({ outcome: 'unavailable', user_id: u.id })])
  })
})
