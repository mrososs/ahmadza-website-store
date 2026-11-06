// Partial-catalogue recovery: provenance, explicit readiness reasons, the publication guard, auto-demotion, conservative promotion, privileges.
// Fixtures are tagged (is_demo = true, legacy ids 910000+) and removed afterwards; nothing here touches real data.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'

const svc = serviceClient()
const TAG = '[recovery-test] '
let seq = 0
let runId = 0
let adminId = ''
const staged: string[] = []

async function legacyBook(over: Record<string, unknown> = {}) {
  const n = ++seq
  const row = { title: `${TAG}${n}`, kind: 'paid', status: 'draft', price_amount: 12.5, legacy_cost_raw: '12.50', provenance: 'legacy', legacy_id: 910000 + n, legacy_status_raw: '1', is_demo: true, import_run_id: runId, ...over }
  const { data, error } = await svc.from('books').insert(row as never).select('id').single()
  if (error) throw new Error(`fixture book: ${error.message}`)
  return data.id as number
}
/** A media row that passes validation: stored, hashed, clean quarantine record for the same hash, legacy relationship present. */
async function validatedMedia(bookId: number, over: Record<string, unknown> = {}) {
  const n = ++seq
  const sha = n.toString(16).padStart(64, 'a')
  const { data, error } = await svc.from('book_media').insert({
    book_id: bookId, name: `${TAG}m${n}`, visibility: 'after_purchase', storage_path: `books/${bookId}/recovery-test-${n}.pdf`, sha256: sha, byte_size: 1234,
    legacy_book_media_id: 910000 + n, legacy_path: `storage/app/public/product_media/recovery-test-${n}.pdf`, ...over,
  } as never).select('id,migration_status').single()
  if (error) throw new Error(`fixture media: ${error.message}`)
  const path = `storage/app/public/product_media/recovery-test-${n}.pdf`
  staged.push(path)
  await svc.from('legacy_media_staging').insert({ legacy_path: path, sha256: sha, byte_size: 1234, detected_type: 'pdf', status: 'staged', scope: 'product', scanned_at: new Date().toISOString(), av_result: 'clean', book_media_id: data.id } as never)
  return data.id as number
}
const readiness = async (id: number) => (await svc.rpc('book_readiness', { p_book: id })).data?.[0] as { eligible: boolean; reasons: string[] }
const setStatus = (id: number, status: string) => svc.from('books').update({ status } as never).eq('id', id)

beforeAll(async () => {
  adminId = (await signedInClient(DEV_USERS.admin)).userId
  runId = (await svc.from('migration_runs').insert({ kind: 'recovery-test', dry_run: false }).select('id').single()).data!.id
})
afterAll(async () => {
  await svc.from('legacy_media_staging').delete().in('legacy_path', staged)
  await svc.from('books').delete().like('title', `${TAG}%`)
  await svc.from('migration_runs').delete().eq('id', runId)
})

describe('explicit readiness reasons', () => {
  it('a fresh recovered draft with valid fields still lists exactly what is missing: verification and media', async () => {
    const id = await legacyBook()
    expect((await readiness(id)).reasons.sort()).toEqual(['no_validated_media', 'source_not_verified'])
  })
  it('an unparsable price keeps the raw string and a 0.00 placeholder, and is explicitly blocked', async () => {
    const id = await legacyBook({ price_amount: 0, legacy_cost_raw: 'abc' })
    const { data } = await svc.from('books').select('price_amount,legacy_cost_raw,status').eq('id', id).single()
    expect(data).toMatchObject({ price_amount: 0, legacy_cost_raw: 'abc', status: 'draft' })
    expect((await readiness(id)).reasons).toContain('price_unparsable_or_zero')
  })
  it('a paid book with NO price information says price_missing; unknown / unpublishable legacy status is explicit', async () => {
    expect((await readiness(await legacyBook({ price_amount: 0, legacy_cost_raw: null }))).reasons).toContain('price_missing')
    expect((await readiness(await legacyBook({ legacy_status_raw: null }))).reasons).toContain('legacy_status_unknown')
    expect((await readiness(await legacyBook({ legacy_status_raw: '0' }))).reasons).toContain('legacy_status_not_publishable')
    expect((await readiness(await legacyBook({ legacy_status_raw: '7' }))).reasons).toContain('legacy_status_not_publishable')
  })
  it('external links, unscanned files, files without a hash and media without a legacy relationship do NOT count as validated', async () => {
    const id = await legacyBook()
    await svc.from('book_media').insert({ book_id: id, name: 'ext', is_external: true, external_url: 'https://example.invalid/a.pdf', legacy_book_media_id: 910999 } as never)
    expect((await readiness(id)).reasons).toContain('no_validated_media')
    const n = ++seq
    await svc.from('book_media').insert({ book_id: id, name: 'unscanned', storage_path: `books/${id}/u${n}.pdf`, sha256: n.toString(16).padStart(64, 'b'), legacy_book_media_id: 910000 + n } as never)
    expect((await readiness(id)).reasons).toContain('no_validated_media')
    await validatedMedia(id, { legacy_book_media_id: null })           // clean file, but no legacy relationship -> relationship not verified
    expect((await readiness(id)).reasons).toContain('no_validated_media')
  })
})

describe('the publication guard (database level)', () => {
  it('refuses to publish an ineligible recovered book and names every reason', async () => {
    const id = await legacyBook()
    const r = await setStatus(id, 'published')
    expect(r.error?.code).toBe('AW001')
    expect(r.error?.message).toMatch(/book_not_eligible: .*source_not_verified/)
    expect(r.error?.message).toMatch(/no_validated_media/)
    expect((await svc.from('books').select('status').eq('id', id).single()).data!.status).toBe('draft')
  })
  it('refuses to INSERT a recovered book as published', async () => {
    const r = await svc.from('books').insert({ title: `${TAG}direct`, kind: 'free', status: 'published', price_amount: 0, provenance: 'legacy', legacy_id: 919001, legacy_status_raw: '1', is_demo: true } as never)
    expect(r.error?.code).toBe('AW001')
  })
  it('verification alone is not enough; media alone is not enough; both together are', async () => {
    const id = await legacyBook()
    await validatedMedia(id)
    expect((await setStatus(id, 'published')).error?.code).toBe('AW001')          // media ok, source not verified
    const id2 = await legacyBook()
    expect((await svc.rpc('verify_legacy_run', { p_run: runId, p_admin: adminId })).data).toBeGreaterThanOrEqual(2)
    expect((await setStatus(id2, 'published')).error?.code).toBe('AW001')         // verified, no media
    expect((await readiness(id)).reasons).toEqual([])                              // id: verified in the same call + media
    expect((await setStatus(id, 'published')).error).toBeNull()
    expect((await svc.from('books').select('status,legacy_verified_by').eq('id', id).single()).data).toMatchObject({ status: 'published', legacy_verified_by: adminId })
  })
  it('a genuinely free book (price 0) with coming-soon legacy status can be eligible', async () => {
    const id = await legacyBook({ kind: 'free', price_amount: 0, legacy_cost_raw: null, legacy_status_raw: '2', legacy_verified_at: new Date().toISOString() })
    await validatedMedia(id)
    expect((await readiness(id)).eligible).toBe(true)
    expect((await setStatus(id, 'coming_soon')).error).toBeNull()
  })
  it('admin-created books are NOT subject to the recovery rules (existing behaviour unchanged)', async () => {
    const { data, error } = await svc.from('books').insert({ title: `${TAG}admin-created`, kind: 'free', status: 'published', price_amount: 0, provenance: 'admin', is_demo: true } as never).select('id').single()
    expect(error).toBeNull()
    expect(data!.id).toBeGreaterThan(0)
  })
  it('a published recovered book falls back to draft when its last validated media disappears', async () => {
    const id = await legacyBook({ legacy_verified_at: new Date().toISOString() })
    const m = await validatedMedia(id)
    expect((await setStatus(id, 'published')).error).toBeNull()
    await svc.from('book_media').delete().eq('id', m)
    expect((await svc.from('books').select('status').eq('id', id).single()).data!.status).toBe('draft')
  })
})

describe('conservative promotion', () => {
  it('promotes only eligible drafts, to their ORIGINAL status, and leaves every other book untouched; running it twice changes nothing', async () => {
    const stamp = new Date().toISOString()
    const ok1 = await legacyBook({ legacy_verified_at: stamp, legacy_status_raw: '1' })
    const ok2 = await legacyBook({ kind: 'free', price_amount: 0, legacy_cost_raw: null, legacy_verified_at: stamp, legacy_status_raw: '2' })
    const noMedia = await legacyBook({ legacy_verified_at: stamp })
    const unverified = await legacyBook()
    const badPrice = await legacyBook({ price_amount: 0, legacy_cost_raw: 'abc', legacy_verified_at: stamp })
    const wasDraft = await legacyBook({ legacy_verified_at: stamp, legacy_status_raw: '0' })
    for (const id of [ok1, ok2, unverified, badPrice, wasDraft]) await validatedMedia(id)
    const first = await svc.rpc('promote_eligible_books', { p_run: runId })
    expect(first.error).toBeNull()
    const promoted = Object.fromEntries((first.data as { book_id: number; new_status: string }[]).map((x) => [x.book_id, x.new_status]))
    expect(promoted[ok1]).toBe('published')
    expect(promoted[ok2]).toBe('coming_soon')
    for (const id of [noMedia, unverified, badPrice, wasDraft]) expect(promoted[id], `book ${id} must stay a draft`).toBeUndefined()
    expect(((await svc.rpc('promote_eligible_books', { p_run: runId })).data as unknown[]).filter((x: any) => [ok1, ok2].includes(x.book_id))).toHaveLength(0)
    const { data } = await svc.from('books').select('id,status').in('id', [noMedia, unverified, badPrice, wasDraft])
    expect(data!.every((b) => b.status === 'draft')).toBe(true)
  })
})

describe('nothing here is reachable from the browser', () => {
  it('anonymous and signed-in users cannot call the functions or read the readiness view', async () => {
    const id = await legacyBook()
    const { client } = await signedInClient(DEV_USERS.customer)
    for (const c of [anonClient(), client]) {
      expect((await c.rpc('book_readiness' as never, { p_book: id } as never)).error).not.toBeNull()
      expect((await c.rpc('verify_legacy_run' as never, { p_run: runId, p_admin: adminId } as never)).error).not.toBeNull()
      expect((await c.rpc('promote_eligible_books' as never, {} as never)).error).not.toBeNull()
      expect((await c.from('books_readiness' as never).select('book_id').limit(1)).error).not.toBeNull()
    }
  })
  it('the new provenance columns are not readable through the public Data API', async () => {
    const anon = anonClient()
    for (const col of ['provenance', 'legacy_status_raw', 'legacy_verified_at', 'legacy_verified_by', 'import_run_id']) {
      expect((await anon.from('books').select(col as 'id').limit(1)).error?.code, col).toBe('42501')
    }
  })
  it('the readiness view reports the same reasons the function does', async () => {
    const id = await legacyBook({ price_amount: 0, legacy_cost_raw: 'abc' })
    const v = (await svc.from('books_readiness' as never).select('reasons,eligible,media_total,media_validated').eq('book_id', id).single()).data as { reasons: string[]; eligible: boolean }
    expect(v.eligible).toBe(false)
    expect(v.reasons.sort()).toEqual((await readiness(id)).reasons.sort())
  })
})
