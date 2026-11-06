// Admin recovery API: authorisation, readiness in list/detail, the 409 publication refusal with reasons, verification phrase, conservative promotion.
// Run against the dev server (TEST_APP_URL) + LOCAL dev Supabase. Fixtures are tagged (is_demo, legacy ids 920000+) and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RECOVERY_VERIFY_PHRASE } from '../../shared/constants/recovery'
import { apiAs, DEV_USERS, serviceClient } from '../helpers/supabase'

type Api = Awaited<ReturnType<typeof apiAs>>
let guest: Api, customer: Api, admin: Api
const svc = serviceClient()
const TAG = '[recovery-api-test] '
let runId = 0
let seq = 0
const staged: string[] = []

async function legacyBook(over: Record<string, unknown> = {}) {
  const n = ++seq
  const row = { title: `${TAG}${n}`, kind: 'paid', status: 'draft', price_amount: 9, legacy_cost_raw: '9', provenance: 'legacy', legacy_id: 920000 + n, legacy_status_raw: '1', is_demo: true, import_run_id: runId, ...over }
  const { data, error } = await svc.from('books').insert(row as never).select('id').single()
  if (error) throw new Error(`fixture book: ${error.message}`)
  return data.id as number
}
async function validatedMedia(bookId: number) {
  const n = ++seq
  const sha = n.toString(16).padStart(64, 'c')
  const path = `storage/app/public/product_media/recovery-api-test-${n}.pdf`
  const { data, error } = await svc.from('book_media').insert({
    book_id: bookId, name: `${TAG}m${n}`, visibility: 'after_purchase', storage_path: `books/${bookId}/recovery-api-test-${n}.pdf`, sha256: sha, byte_size: 99,
    legacy_book_media_id: 920000 + n, legacy_path: path,
  } as never).select('id').single()
  if (error) throw new Error(`fixture media: ${error.message}`)
  staged.push(path)
  await svc.from('legacy_media_staging').insert({ legacy_path: path, sha256: sha, byte_size: 99, detected_type: 'pdf', status: 'staged', scope: 'product', scanned_at: new Date().toISOString(), av_result: 'clean', book_media_id: data.id } as never)
}
const putBook = (id: number, over: Record<string, unknown>) => admin(`/api/admin/books/${id}`, { method: 'PUT', json: { title: `${TAG}edit`, kind: 'paid', status: 'draft', price_amount: 9, pages: 0, category_ids: [], maker_ids: [], tags: [], related_ids: [], ...over } })
const idsOf = (r: { items: Array<{ id: number }> }) => r.items.map((b) => b.id)

beforeAll(async () => {
  guest = await apiAs(null)
  customer = await apiAs(DEV_USERS.customer)
  admin = await apiAs(DEV_USERS.admin)
  runId = (await svc.from('migration_runs').insert({ kind: 'recovery-api-test', dry_run: false }).select('id').single()).data!.id
})
afterAll(async () => {
  await svc.from('legacy_media_staging').delete().in('legacy_path', staged)
  await svc.from('books').delete().like('title', `${TAG}%`)
  await svc.from('migration_runs').delete().eq('id', runId)
})

describe('authorisation', () => {
  for (const route of ['/api/admin/recovery/summary', '/api/admin/recovery/rejects']) {
    it(`GET ${route}: 401 guest / 403 customer / 200 admin`, async () => {
      expect((await guest(route)).status).toBe(401)
      expect((await customer(route)).status).toBe(403)
      expect((await admin(route)).status).toBe(200)
    })
  }
  for (const route of ['/api/admin/recovery/verify', '/api/admin/recovery/promote']) {
    it(`POST ${route}: 401 guest / 403 customer`, async () => {
      expect((await guest(route, { method: 'POST', json: {} })).status).toBe(401)
      expect((await customer(route, { method: 'POST', json: {} })).status).toBe(403)
    })
  }
})

describe('publication refusal', () => {
  it('publishing an unverified recovered book through the admin API is a 409 with the exact reasons, and the book stays a draft', async () => {
    const id = await legacyBook()
    const res = await putBook(id, { status: 'published' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.data.code).toBe('book_not_eligible')
    expect(body.data.reasons.sort()).toEqual(['no_validated_media', 'source_not_verified'])
    expect((await svc.from('books').select('status').eq('id', id).single()).data?.status).toBe('draft')
  })
  it('saving as a draft always works, including a price fix by the admin (which clears the price reason)', async () => {
    const id = await legacyBook({ price_amount: 0, legacy_cost_raw: 'abc' })
    expect((await admin(`/api/admin/books/${id}`)).status).toBe(200)
    expect((await putBook(id, { status: 'draft', price_amount: 15 })).status).toBeLessThan(300)
    const detail = await (await admin(`/api/admin/books/${id}`)).json()
    expect(detail.readiness.reasons).not.toContain('price_unparsable_or_zero')
    expect(detail.legacy_cost_raw).toBe('abc') // the original raw value is preserved
  })
  it('an admin-created book is not subject to the recovery rule', async () => {
    const res = await admin('/api/admin/books', { method: 'POST', json: { title: `${TAG}admin-made`, kind: 'free', status: 'published', price_amount: 0, pages: 1, category_ids: [], maker_ids: [], tags: [], related_ids: [] } })
    expect(res.status).toBe(201)
  })
})

describe('list filter and detail readiness', () => {
  it('recovery filters return only recovered books with readiness attached; unknown filter values are rejected', async () => {
    const blocked = await legacyBook()
    const ready = await legacyBook({ legacy_verified_at: new Date().toISOString() })
    await validatedMedia(ready)
    const q = encodeURIComponent(TAG)
    const all = await (await admin(`/api/admin/books?recovery=recovered&q=${q}`)).json()
    expect(idsOf(all)).toEqual(expect.arrayContaining([blocked, ready]))
    expect(all.items.every((b: { provenance: string }) => b.provenance === 'legacy')).toBe(true)
    const notReady = await (await admin(`/api/admin/books?recovery=not_ready&q=${q}`)).json()
    expect(idsOf(notReady)).toContain(blocked)
    expect(idsOf(notReady)).not.toContain(ready)
    const readyList = await (await admin(`/api/admin/books?recovery=ready&q=${q}`)).json()
    expect(idsOf(readyList)).toContain(ready)
    const noMedia = await (await admin(`/api/admin/books?recovery=missing_media&q=${q}`)).json()
    expect(idsOf(noMedia)).toContain(blocked)
    expect(idsOf(noMedia)).not.toContain(ready)
    expect((await admin('/api/admin/books?recovery=bogus')).status).toBe(400)
    const detail = await (await admin(`/api/admin/books/${ready}`)).json()
    expect(detail.readiness).toEqual({ eligible: true, reasons: [] })
    expect(detail.media_readiness).toHaveLength(1)
    expect(detail.media_readiness[0].validated).toBe(true)
  })
})

describe('verification and promotion', () => {
  it('verify needs the exact confirmation phrase and never publishes; promote then publishes only eligible books at their original status', async () => {
    const complete = await legacyBook({ legacy_status_raw: '1' })
    const soon = await legacyBook({ legacy_status_raw: '2' })
    const noMedia = await legacyBook()
    const badPrice = await legacyBook({ price_amount: 0, legacy_cost_raw: 'abc' })
    await validatedMedia(complete)
    await validatedMedia(soon)
    await validatedMedia(badPrice)
    const all = [complete, soon, noMedia, badPrice]

    expect((await admin('/api/admin/recovery/verify', { method: 'POST', json: { run: runId, confirm: 'yes' } })).status).toBe(400)
    expect((await svc.from('books').select('legacy_verified_at').eq('id', complete).single()).data?.legacy_verified_at).toBeNull()

    const v = await admin('/api/admin/recovery/verify', { method: 'POST', json: { run: runId, confirm: RECOVERY_VERIFY_PHRASE } })
    expect(v.status).toBe(200)
    expect((await v.json()).verified).toBeGreaterThanOrEqual(4)
    const afterVerify = await svc.from('books').select('id,status').in('id', all)
    expect(afterVerify.data?.every((b) => b.status === 'draft')).toBe(true) // verification alone publishes nothing

    const p = await admin('/api/admin/recovery/promote', { method: 'POST', json: { run: runId } })
    expect(p.status).toBe(200)
    const statuses = Object.fromEntries((await svc.from('books').select('id,status').in('id', all)).data!.map((b) => [b.id, b.status]))
    expect(statuses[complete]).toBe('published')
    expect(statuses[soon]).toBe('coming_soon')
    expect(statuses[noMedia]).toBe('draft') // no validated media
    expect(statuses[badPrice]).toBe('draft') // unparsable price

    const audit = await svc.from('audit_log').select('action').in('action', ['recovery.verify_run', 'recovery.promote_eligible']).order('id', { ascending: false }).limit(2)
    expect(audit.data?.map((a) => a.action).sort()).toEqual(['recovery.promote_eligible', 'recovery.verify_run'])
  })
  it('the summary reports blockers with Arabic labels and counts only (no raw payloads)', async () => {
    const s = await (await admin('/api/admin/recovery/summary')).json()
    expect(s.books.recovered).toBeGreaterThanOrEqual(4)
    expect(s.blockers.every((b: { label: string; count: number }) => b.label && b.count > 0)).toBe(true)
    expect(JSON.stringify(s)).not.toMatch(/payload|password|hash/i)
  })
})
