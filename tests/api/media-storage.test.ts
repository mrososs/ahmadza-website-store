// Media storage boundary: metadata model, safe failure when the backend is not ready, and column privacy.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, apiAs, serviceClient } from '../helpers/supabase'

const svc = serviceClient()
const created: number[] = []
let bookId: number

async function addMedia(row: Record<string, unknown>) {
  const r = await svc.from('book_media').insert({ book_id: bookId, visibility: 'preview', name: 'storage-test', ...row } as never).select('id,storage_provider,migration_status,is_external').single()
  if (r.data) created.push(r.data.id)
  return r
}

beforeAll(async () => {
  bookId = (await svc.from('books').select('id').eq('status', 'published').eq('is_demo', true).is('deleted_at', null).order('id').limit(1).single()).data!.id
})
afterAll(async () => { if (created.length) await svc.from('book_media').delete().in('id', created) })

describe('metadata model', () => {
  it('a placeholder row (no file yet) is "none / pending" and is accepted', async () => {
    const r = await addMedia({})
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ storage_provider: 'none', migration_status: 'pending', is_external: false })
  })

  it('a row with an object key defaults to supabase/available; an external url becomes external/available', async () => {
    const a = await addMedia({ storage_path: `books/${bookId}/unit-test.pdf` })
    expect(a.data).toMatchObject({ storage_provider: 'supabase', migration_status: 'available' })
    const e = await addMedia({ external_url: 'https://example.invalid/file.pdf', is_external: true })
    expect(e.data).toMatchObject({ storage_provider: 'external', migration_status: 'available', is_external: true })
  })

  it('"available" can never point at nothing, and providers must be consistent with their keys', async () => {
    const none = await addMedia({ migration_status: 'available' })
    expect(none.data?.migration_status).toBe('pending')
    expect((await addMedia({ storage_provider: 'vps' })).error?.code).toBe('23514')            // vps needs an object key
    expect((await addMedia({ storage_provider: 'supabase' })).error?.code).toBe('23514')        // supabase needs an object key too
  })

  it('checksum and size are validated', async () => {
    expect((await addMedia({ sha256: 'xyz' })).error?.code).toBe('23514')
    expect((await addMedia({ byte_size: -5 })).error?.code).toBe('23514')
    expect((await addMedia({ sha256: 'a'.repeat(64), byte_size: 123, mime_type: 'application/pdf' })).error).toBeNull()
  })

  it('the Data API shows migration status but never provider, key, checksum or legacy path', async () => {
    const anon = anonClient()
    expect((await anon.from('book_media').select('id,migration_status').limit(1)).error).toBeNull()
    for (const col of ['storage_provider', 'storage_path', 'sha256', 'legacy_path', 'external_url', 'mime_type']) {
      expect((await anon.from('book_media').select(col as 'id').limit(1)).error?.code, col).toBe('42501')
    }
  })
})

describe('delivery fails safely instead of pretending', () => {
  it('pending media -> 503 with an explicit reason, never a redirect or a path', async () => {
    const pending = await addMedia({})
    const res = await (await apiAs(null))(`/api/library/download/${pending.data!.id}`)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.data?.reason).toBe('pending')
    expect(JSON.stringify(body)).not.toMatch(/storage_path|books\//)
    expect(res.headers.get('location')).toBeNull()
  })

  it('a VPS-backed row is refused while the VPS backend is not enabled (no fabricated URL)', async () => {
    const vps = await addMedia({ storage_provider: 'vps', storage_path: `books/${bookId}/future.pdf`, migration_status: 'available' })
    const res = await (await apiAs(null))(`/api/library/download/${vps.data!.id}`)
    expect(res.status).toBe(503)
    // not enabled in any environment yet; once enabled the adapter itself still answers not_implemented until the VPS phase
    expect((await res.json()).data?.reason).toBe('provider_disabled')
  })

  it('staged-but-unverified media is not served', async () => {
    const staged = await addMedia({ storage_provider: 'supabase', storage_path: `books/${bookId}/staged.pdf`, migration_status: 'staged' })
    const res = await (await apiAs(null))(`/api/library/download/${staged.data!.id}`)
    expect(res.status).toBe(503)
  })

  it('a non-https external location is refused', async () => {
    const ext = await addMedia({ external_url: 'http://example.invalid/insecure.pdf', is_external: true })
    const res = await (await apiAs(null))(`/api/library/download/${ext.data!.id}`)
    expect(res.status).toBe(404)
    expect(res.headers.get('location')).toBeNull()
  })

  it('available external https media still redirects (the one backend usable in hosted environments)', async () => {
    const ext = await addMedia({ external_url: 'https://example.invalid/ok.pdf', is_external: true })
    const res = await (await apiAs(null))(`/api/library/download/${ext.data!.id}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://example.invalid/ok.pdf')
  })
})
