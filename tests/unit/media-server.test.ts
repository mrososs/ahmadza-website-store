// Private media service + Nuxt VPS adapter, end to end against a real in-process server on a temp directory.
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMediaServer } from '../../services/media-server/server.mjs'
import { VpsStorageAdapter } from '../../server/services/storage/adapters'
import { MediaUnavailableError, type MediaRecord } from '../../server/services/storage/types'
import { signDownload, verifyDownload } from '../../server/services/storage/vpsSignature'

const SECRET = 's'.repeat(40)
const OLD_SECRET = 'o'.repeat(40)
const TOKEN = 't'.repeat(40)
const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5000, 7), Buffer.from('\n%%EOF')])
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const keyFor = (b: Buffer) => `sha256/${sha(b).slice(0, 2)}/${sha(b)}.pdf`

let root: string
let base: string
let server: ReturnType<typeof createMediaServer>
let clock = Date.now()
const logs: Record<string, unknown>[] = []

function start(overrides: Record<string, unknown> = {}) {
  const s = createMediaServer({ root, secrets: [SECRET, OLD_SECRET], uploadToken: TOKEN, now: () => clock, log: (l: Record<string, unknown>) => logs.push(l), ...overrides })
  return new Promise<{ s: typeof s; url: string }>((r) => s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` })))
}
const put = (key: string, body: Buffer, headers: Record<string, string> = {}) =>
  fetch(`${base}/objects/${key}`, { method: 'PUT', body: body as unknown as BodyInit, headers: { authorization: `Bearer ${TOKEN}`, 'x-content-sha256': sha(body), ...headers } })
const signedUrl = (key: string, { ttl = 120, dn = 'book.pdf', secret = SECRET } = {}) => {
  const exp = Math.floor(clock / 1000) + ttl
  return `${base}/objects/${key}?${new URLSearchParams({ exp: String(exp), dn, sig: signDownload(secret, key, exp, dn) })}`
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'aawraq-media-'))
  const s = await start(); server = s.s; base = s.url
  expect((await put(keyFor(pdf), pdf)).status).toBe(201)
})
afterAll(async () => { server.close(); await rm(root, { recursive: true, force: true }) })

describe('signature compatibility (Nuxt signs, service verifies)', () => {
  it('the TS signer and the service agree, and rotation accepts the previous secret', async () => {
    const key = keyFor(pdf)
    expect((await fetch(signedUrl(key))).status).toBe(200)
    expect((await fetch(signedUrl(key, { secret: OLD_SECRET }))).status).toBe(200)
    expect(verifyDownload([SECRET], { key, exp: '1', dn: '', sig: signDownload(SECRET, key, 1, '') }, 0, 300)).toBe('ok')
  })
})

describe('authorised download', () => {
  it('streams the exact bytes with attachment, nosniff and no-store headers', async () => {
    const res = await fetch(signedUrl(keyFor(pdf), { dn: 'كتاب.pdf' }))
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
  })

  it('supports Range: partial, open-ended, suffix, unsatisfiable (416) and ignores junk', async () => {
    const url = signedUrl(keyFor(pdf))
    const a = await fetch(url, { headers: { range: 'bytes=0-9' } })
    expect(a.status).toBe(206)
    expect(a.headers.get('content-range')).toBe(`bytes 0-9/${pdf.length}`)
    expect(Buffer.from(await a.arrayBuffer()).equals(pdf.subarray(0, 10))).toBe(true)
    const b = await fetch(url, { headers: { range: `bytes=${pdf.length - 4}-` } })
    expect(b.status).toBe(206); expect(Buffer.from(await b.arrayBuffer()).equals(pdf.subarray(-4))).toBe(true)
    const c = await fetch(url, { headers: { range: 'bytes=-6' } })
    expect(Buffer.from(await c.arrayBuffer()).equals(pdf.subarray(-6))).toBe(true)
    const d = await fetch(url, { headers: { range: `bytes=${pdf.length + 10}-` } })
    expect(d.status).toBe(416); expect(d.headers.get('content-range')).toBe(`bytes */${pdf.length}`)
    await d.arrayBuffer()
    const e = await fetch(url, { headers: { range: 'bytes=0-1,5-6' } })
    expect(e.status).toBe(200); await e.arrayBuffer()
  })
})

describe('rejections', () => {
  it('no token / garbage token / tampered fields -> 403', async () => {
    const key = keyFor(pdf)
    expect((await fetch(`${base}/objects/${key}`)).status).toBe(403)
    expect((await fetch(`${base}/objects/${key}?exp=${Math.floor(clock / 1000) + 60}&dn=x&sig=AAAA`)).status).toBe(403)
    const url = new URL(signedUrl(key))
    const tamperedName = new URL(url); tamperedName.searchParams.set('dn', 'other.pdf')
    expect((await fetch(tamperedName)).status).toBe(403)
    const tamperedExp = new URL(url); tamperedExp.searchParams.set('exp', String(Number(url.searchParams.get('exp')) + 3600))
    expect((await fetch(tamperedExp)).status).toBe(403)
  })

  it('a token for one object does not open another (incorrect media key)', async () => {
    const other = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 1)])
    expect((await put(keyFor(other), other)).status).toBe(201)
    const t = new URL(signedUrl(keyFor(pdf)))
    expect((await fetch(`${base}/objects/${keyFor(other)}${t.search}`)).status).toBe(403)
  })

  it('an expired token -> 403 "expired"; a token with an absurd lifetime is refused', async () => {
    const key = keyFor(pdf)
    const url = signedUrl(key, { ttl: 60 })
    clock += 61_000
    const res = await fetch(url)
    expect(res.status).toBe(403); expect((await res.json()).error).toBe('expired')
    expect((await fetch(signedUrl(key, { ttl: 24 * 3600 }))).status).toBe(403)
  })

  it('missing file with a valid token -> 404; unknown / traversal keys never touch the filesystem', async () => {
    const ghost = `sha256/ab/${'ab'.repeat(32)}.pdf`
    expect((await fetch(signedUrl(ghost))).status).toBe(404)
    for (const p of ['/objects/../../etc/passwd', '/objects/%2e%2e%2f%2e%2e%2fetc%2fpasswd', `/objects/books/1/..%2f..%2f${randomUUID()}.pdf`, '/objects/sha256/zz/x.pdf', '/objects/', '/etc/passwd', '/objects/books/1/x.php']) {
      const res = await fetch(`${base}${p}`); expect(res.status, p).toBe(404); await res.arrayBuffer()
    }
  })

  it('methods other than the contract are refused', async () => {
    expect((await fetch(`${base}/objects/${keyFor(pdf)}`, { method: 'POST' })).status).toBe(405)
  })

  it('logs never contain the signature', () => {
    expect(JSON.stringify(logs)).not.toMatch(/sig=|signature/i)
  })
})

describe('uploads (administrative surface)', () => {
  it('requires the bearer token', async () => {
    const body = Buffer.from('%PDF-1.4 x')
    expect((await fetch(`${base}/objects/${keyFor(body)}`, { method: 'PUT', body, headers: { 'x-content-sha256': sha(body) } })).status).toBe(401)
    expect((await fetch(`${base}/objects/${keyFor(body)}`, { method: 'PUT', body, headers: { authorization: 'Bearer nope', 'x-content-sha256': sha(body) } })).status).toBe(401)
  })

  it('refuses a wrong checksum, wrong magic bytes, a non-content-addressed key, and overwrites', async () => {
    const body = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 9)])
    expect((await put(keyFor(body), body, { 'x-content-sha256': 'f'.repeat(64) })).status).toBe(422)
    const evil = Buffer.from('<?php system($_GET[0]); ?>')
    expect((await put(keyFor(evil), evil)).status).toBe(422)
    expect((await put(`sha256/00/${'0'.repeat(64)}.pdf`, body)).status).toBe(422)
    const perBook = `books/42/${randomUUID()}.pdf`
    expect((await put(perBook, body)).status).toBe(201)
    expect((await put(perBook, Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10)]))).status).toBe(409)
    expect((await put(keyFor(pdf), pdf)).status).toBe(409)
    expect((await readdir(join(root, 'tmp'))).length).toBe(0) // no staging leftovers
  })

  it('DELETE moves to trash and the object stops being served', async () => {
    const body = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(80, 3)])
    const key = `books/7/${randomUUID()}.pdf`
    expect((await put(key, body)).status).toBe(201)
    expect((await fetch(`${base}/objects/${key}`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200)
    expect((await fetch(signedUrl(key))).status).toBe(404)
    expect((await stat(join(root, 'trash'))).isDirectory()).toBe(true)
  })
})

describe('rate limiting', () => {
  it('limits downloads per client and locks out repeated bad signatures', async () => {
    const { s, url } = await start({ getLimitPerMin: 3, failLimitPerMin: 4 })
    try {
      const key = keyFor(pdf)
      const ok = () => { const e = Math.floor(clock / 1000) + 60; return fetch(`${url}/objects/${key}?${new URLSearchParams({ exp: String(e), dn: 'a', sig: signDownload(SECRET, key, e, 'a') })}`) }
      const first = await Promise.all([ok(), ok(), ok()]); for (const r of first) { expect(r.status).toBe(200); await r.arrayBuffer() }
      expect((await ok()).status).toBe(429)
    } finally { s.close() }
    const b = await start({ failLimitPerMin: 3 })
    try {
      for (let i = 0; i < 3; i++) { const r = await fetch(`${b.url}/objects/${keyFor(pdf)}?exp=${Math.floor(clock / 1000) + 60}&dn=a&sig=bad`); expect(r.status).toBe(403); await r.arrayBuffer() }
      expect((await fetch(`${b.url}/objects/${keyFor(pdf)}?exp=1&dn=a&sig=bad`)).status).toBe(429)
    } finally { b.s.close() }
  })
})

describe('Nuxt VpsStorageAdapter against the service', () => {
  const adapter = () => new VpsStorageAdapter({ baseUrl: base, signingSecret: SECRET, uploadToken: TOKEN }, () => clock)
  const media = (over: Partial<MediaRecord>): MediaRecord => ({ id: 1, book_id: 1, name: 'n', extension: 'pdf', storage_provider: 'vps', storage_path: keyFor(pdf), external_url: null, migration_status: 'available', ...over })

  it('deliver() returns a short-lived signed URL that the service honours exactly once-per-ttl', async () => {
    const d = await adapter().deliver(media({}), { ttlSeconds: 120, downloadName: 'كتاب.pdf' })
    expect(d.kind).toBe('redirect')
    const res = await fetch(d.url)
    expect(res.status).toBe(200); expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true)
    expect(d.url).not.toContain(root.replaceAll('\\', '/'))
  })

  it('put/head/archive round trip, and deliver() on a missing object is an explicit object_missing', async () => {
    const a = adapter(); const bytes = Buffer.concat([Buffer.from('%PDF-1.5\n'), Buffer.alloc(200, 5)]); const key = `books/9/${randomUUID()}.pdf`
    expect(await a.put(key, bytes, sha(bytes))).toMatchObject({ key, sha256: sha(bytes) })
    expect(await a.head(key)).toMatchObject({ exists: true, bytes: bytes.length })
    await a.archive(key)
    expect((await a.head(key)).exists).toBe(false)
    await expect(a.deliver(media({ storage_path: key }), { ttlSeconds: 60, downloadName: 'x.pdf' })).rejects.toMatchObject({ reason: 'object_missing' })
    await expect(a.put(`books/9/${randomUUID()}.pdf`, bytes, 'a'.repeat(64))).rejects.toBeInstanceOf(MediaUnavailableError)
  })

  it('rejects unsafe keys and insecure/unconfigured setups before any network call', async () => {
    await expect(adapter().deliver(media({ storage_path: '../../etc/passwd' }), { ttlSeconds: 60, downloadName: 'x' })).rejects.toMatchObject({ reason: 'invalid_source' })
    await expect(adapter().deliver(media({ storage_path: null }), { ttlSeconds: 60, downloadName: 'x' })).rejects.toMatchObject({ reason: 'pending' })
    expect(() => new VpsStorageAdapter({ baseUrl: 'http://files.example.com', signingSecret: SECRET, uploadToken: TOKEN })).toThrow(/https/)
    expect(() => new VpsStorageAdapter({ baseUrl: 'https://files.example.com', signingSecret: '', uploadToken: '' })).toThrow(/not configured/)
  })
})

describe('CORS for the in-browser reader (exact-origin allow-list)', () => {
  const ALLOWED = 'https://store.example'
  it('answers the preflight and tags deliveries only for an allowed origin; others get nothing', async () => {
    const s = await start({ allowedOrigins: [ALLOWED] })
    try {
      const url = signedUrl(keyFor(pdf)).replace(base, s.url)
      const ok = await fetch(url, { method: 'OPTIONS', headers: { origin: ALLOWED, 'access-control-request-method': 'GET', 'access-control-request-headers': 'range' } })
      expect(ok.status).toBe(204)
      expect(ok.headers.get('access-control-allow-origin')).toBe(ALLOWED)
      expect(ok.headers.get('access-control-allow-headers')).toBe('range')
      const get = await fetch(url, { headers: { origin: ALLOWED, range: 'bytes=0-3' } })
      expect(get.status).toBe(206)
      expect(get.headers.get('access-control-allow-origin')).toBe(ALLOWED)
      expect(get.headers.get('access-control-expose-headers')).toContain('content-range')
      await get.arrayBuffer()
      const evil = await fetch(url, { headers: { origin: 'https://evil.example' } })
      expect(evil.headers.get('access-control-allow-origin')).toBeNull()
      await evil.arrayBuffer()
      expect((await fetch(url, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } })).status).toBe(403)
    } finally { s.s.close() }
  })
  it('without configuration there is no CORS at all', async () => {
    const res = await fetch(signedUrl(keyFor(pdf)), { headers: { origin: ALLOWED } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    await res.arrayBuffer()
  })
})
