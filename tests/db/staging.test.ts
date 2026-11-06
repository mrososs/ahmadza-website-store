// Legacy media staging: access control + the "link without re-uploading" path. Runs against the LOCAL stack.
// Precondition: a staging batch has been run (node scripts/migration/stage-media.mjs) so staged rows exist.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { DEV_USERS, SUPABASE_URL, anonClient, serviceClient, signedInClient } from '../helpers/supabase'
// @ts-expect-error plain .mjs modules (no type declarations)
import { linkMedia } from '../../scripts/migration/lib/link.mjs'

const svc = serviceClient()
let sampleObject = ''

beforeAll(async () => {
  const { data } = await svc.from('legacy_media_staging').select('storage_path').eq('status', 'staged').limit(1)
  sampleObject = data?.[0]?.storage_path ?? ''
})

describe('legacy_media_staging is private', () => {
  it('has staged rows from the first batch (precondition)', () => {
    expect(sampleObject).toMatch(/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.(pdf|png|jpg|webp|mp3)$/)
  })
  it('anonymous users cannot read the table', async () => {
    const { data, error } = await anonClient().from('legacy_media_staging').select('id').limit(1)
    expect(error ?? data).toBeTruthy()
    expect(data ?? []).toHaveLength(0)
  })
  it.each([['customer', DEV_USERS.customer], ['affiliate', DEV_USERS.affiliate]])('%s sees zero rows (RLS), cannot write', async (_n, email) => {
    const { client } = await signedInClient(email)
    const { data, error } = await client.from('legacy_media_staging').select('id').limit(5)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
    const ins = await client.from('legacy_media_staging').insert({ legacy_path: 'x', sha256: '0', byte_size: 1, detected_type: 'pdf' })
    expect(ins.error).toBeTruthy()
  })
  it('admin can read the inventory but still cannot write through the Data API', async () => {
    const { client } = await signedInClient(DEV_USERS.admin)
    const { data, error } = await client.from('legacy_media_staging').select('id').limit(1)
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
    expect((await client.from('legacy_media_staging').update({ status: 'rejected' }).eq('id', -1)).error).toBeTruthy()
  })
})

describe('legacy-staging bucket is not publicly readable', () => {
  it('public URL, anon download and customer download are all refused', async () => {
    const pub = await fetch(`${SUPABASE_URL}/storage/v1/object/public/legacy-staging/${sampleObject}`)
    expect(pub.status).toBeGreaterThanOrEqual(400)
    const anon = await anonClient().storage.from('legacy-staging').download(sampleObject)
    expect(anon.error).toBeTruthy()
    const { client } = await signedInClient(DEV_USERS.customer)
    expect((await client.storage.from('legacy-staging').download(sampleObject)).error).toBeTruthy()
    expect((await client.storage.from('legacy-staging').createSignedUrl(sampleObject, 60)).error).toBeTruthy()
    const list = await client.storage.from('legacy-staging').list('sha256')
    expect(list.data ?? []).toHaveLength(0)
  })
  it('the service role can read an object and its SHA-256 matches the staging row', async () => {
    const { data: row } = await svc.from('legacy_media_staging').select('sha256,byte_size').eq('storage_path', sampleObject).limit(1).single()
    const { data, error } = await svc.storage.from('legacy-staging').download(sampleObject)
    expect(error).toBeNull()
    const buf = Buffer.from(await data!.arrayBuffer())
    expect(buf.length).toBe(row!.byte_size)
    expect(createHash('sha256').update(buf).digest('hex')).toBe(row!.sha256)
  })
  it('rejected members never have a storage object', async () => {
    const { data } = await svc.from('legacy_media_staging').select('storage_path,reason').eq('status', 'rejected')
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((r) => r.storage_path === null && !!r.reason)).toBe(true)
  })
})

describe('linking staged media to a book without re-uploading', () => {
  let bookId = 0
  let stagingId = 0
  const created: string[] = []

  beforeAll(async () => {
    const { data: st } = await svc.from('legacy_media_staging').select('id,legacy_path').eq('status', 'staged').eq('scope', 'product').is('duplicate_of', null).limit(1).single()
    stagingId = st!.id
    const { data: b } = await svc.from('books').insert({ title: 'كتاب اختبار الربط (مؤقت)', kind: 'free', status: 'draft', price_amount: 0, is_demo: true }).select('id').single()
    bookId = b!.id
    ;(globalThis as { __legacyPath?: string }).__legacyPath = st!.legacy_path
  })
  afterAll(async () => {
    const { data: media } = await svc.from('book_media').select('id,storage_path').eq('book_id', bookId)
    for (const m of media ?? []) if (m.storage_path) created.push(m.storage_path)
    if (created.length) await svc.storage.from('private-products').remove(created)
    await svc.from('books').delete().eq('id', bookId) // cascades book_media
    await svc.from('legacy_media_staging').update({ status: 'staged', book_media_id: null }).eq('id', stagingId)
  })

  it('copies inside Storage, inserts book_media with the same SHA-256 and marks the staging row linked', async () => {
    const legacyPath = (globalThis as { __legacyPath?: string }).__legacyPath!
    const report = await linkMedia(svc, [{ legacy_path: legacyPath, book_id: bookId, visibility: 'after_purchase', name: 'ملف اختبار', legacy_book_media_id: 990001 }])
    expect(report.failed).toEqual([])
    expect(report.linked).toHaveLength(1)

    const { data: st } = await svc.from('legacy_media_staging').select('status,book_media_id,sha256,byte_size').eq('id', stagingId).single()
    expect(st!.status).toBe('linked')
    const { data: media } = await svc.from('book_media').select('storage_path,sha256,byte_size,legacy_path,visibility').eq('id', st!.book_media_id!).single()
    expect(media).toMatchObject({ sha256: st!.sha256, byte_size: st!.byte_size, legacy_path: legacyPath, visibility: 'after_purchase' })

    const { data: blob } = await svc.storage.from('private-products').download(media!.storage_path!)
    expect(createHash('sha256').update(Buffer.from(await blob!.arrayBuffer())).digest('hex')).toBe(st!.sha256)
  })

  it('is idempotent and shares the object when two legacy rows point at the same file', async () => {
    const legacyPath = (globalThis as { __legacyPath?: string }).__legacyPath!
    const again = await linkMedia(svc, [{ legacy_path: legacyPath, book_id: bookId, legacy_book_media_id: 990001 }])
    expect(again.linked).toHaveLength(0)
    expect(again.skipped[0].reason).toMatch(/already imported/)
    const second = await linkMedia(svc, [{ legacy_path: legacyPath, book_id: bookId, legacy_book_media_id: 990002, name: 'ثاني' }])
    expect(second.linked[0].shared_object).toBeTruthy()
    const { data } = await svc.from('book_media').select('storage_path').eq('book_id', bookId)
    expect(new Set(data!.map((m) => m.storage_path)).size).toBe(1)
    expect(data).toHaveLength(2)
  })

  it('refuses to link rows that are not staged, and unknown paths', async () => {
    const { data: rej } = await svc.from('legacy_media_staging').select('legacy_path').eq('status', 'rejected').limit(1).single()
    const r = await linkMedia(svc, [{ legacy_path: rej!.legacy_path, book_id: bookId }, { legacy_path: 'nope/none.pdf', book_id: bookId }])
    expect(r.linked).toHaveLength(0)
    expect(r.skipped.map((s: { reason: string }) => s.reason).join()).toMatch(/only staged, verified/)
    expect(r.skipped.map((s: { reason: string }) => s.reason).join()).toMatch(/not in staging inventory/)
  })
})
