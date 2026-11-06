// The protected preview, end to end: a REAL Nuxt server is started on its own port, in protected mode, against the isolated recovery stack
// (.env.recovery, no synthetic data), and probed over HTTP. The server is started and stopped by this test; nothing else is touched.
// Requires: the recovery stack running (scripts/recovery/recovery-stack.ps1 -Action Start). Skipped, loudly, when it is not.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/previewGate'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PORT = 3190
const BASE = `http://localhost:${PORT}` // not 127.0.0.1: on Windows the dev server may listen on IPv6 only
const USER = 'preview-test'
const PASSWORD = 'a long passphrase for the test only'
const hasRecoveryEnv = existsSync(`${ROOT}.env.recovery`)
const auth = (u: string, p: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` })
let server: ChildProcess | undefined
let log = ''

async function waitUntilUp() {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${BASE}/robots.txt`)).status === 200) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`preview server did not start:\n${log.slice(-1500)}`)
}

beforeAll(async () => {
  if (!hasRecoveryEnv) return
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  server = spawn(cmd, ['nuxt', 'dev', '--dotenv', '.env.recovery', '--port', String(PORT), '--extends', './scripts/dev/recovery-layer'], {
    cwd: ROOT, shell: process.platform === 'win32',
    env: { ...process.env, NUXT_PREVIEW_MODE: 'protected', NUXT_PREVIEW_USER: USER, NUXT_PREVIEW_PASSWORD_HASH: hashPassword(PASSWORD), NUXT_TELEMETRY_DISABLED: '1' },
  })
  server.stdout?.on('data', (d) => { log += String(d) })
  server.stderr?.on('data', (d) => { log += String(d) })
  await waitUntilUp()
}, 240_000)

afterAll(() => {
  if (!server?.pid) return
  // only the process tree THIS test started
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
  else server.kill('SIGTERM')
})

describe.skipIf(!hasRecoveryEnv)('protected preview over HTTP', () => {
  it('anonymous visitors get a Basic-auth challenge on pages, assets and API, with no-index headers and no content', async () => {
    for (const path of ['/', '/book/1', '/admin', '/api/admin/books', '/sitemap.xml']) {
      const r = await fetch(`${BASE}${path}`)
      expect(r.status, path).toBe(401)
      expect(r.headers.get('www-authenticate'), path).toMatch(/^Basic /)
      expect(r.headers.get('x-robots-tag'), path).toMatch(/noindex/)
      expect(await r.text(), path).toBe('Authentication required')
    }
  })
  it('robots.txt is open and disallows everything', async () => {
    const r = await fetch(`${BASE}/robots.txt`)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('Disallow: /')
  })
  it('valid credentials reach the site; responses are marked no-index and never cacheable by shared caches', async () => {
    const r = await fetch(`${BASE}/`, { headers: auth(USER, PASSWORD) })
    expect(r.status).toBe(200)
    expect(r.headers.get('x-robots-tag')).toMatch(/noindex/)
    expect(r.headers.get('cache-control')).toMatch(/no-store/)
    expect(await r.text()).toContain('<html')
  })
  it('route rules that set s-maxage (home, book pages) cannot make a protected page cacheable by a CDN', async () => {
    for (const path of ['/', '/book/1', '/post/1', '/p/about']) {
      const r = await fetch(`${BASE}${path}`, { headers: auth(USER, PASSWORD) })
      expect(r.headers.get('cache-control'), path).toBe('private, no-store')
      expect(r.headers.get('cdn-cache-control'), path).toBe('no-store')
      expect(r.headers.get('cache-control'), path).not.toMatch(/s-maxage/)
    }
  })
  it('a wrong password or a wrong user name is refused', async () => {
    expect((await fetch(`${BASE}/`, { headers: auth(USER, 'wrong') })).status).toBe(401)
    expect((await fetch(`${BASE}/`, { headers: auth('someone', PASSWORD) })).status).toBe(401)
  })
  it('even with valid credentials: no checkout, no payment webhooks, no downloads', async () => {
    const h = { ...auth(USER, PASSWORD), 'content-type': 'application/json' }
    for (const [method, path] of [['POST', '/api/checkout/session'], ['POST', '/api/checkout/simulate/x'], ['POST', '/api/webhooks/payments/paymob'], ['GET', '/api/library/download/1']] as const) {
      const r = await fetch(`${BASE}${path}`, { method, headers: h, body: method === 'POST' ? '{}' : undefined, redirect: 'manual' })
      expect(r.status, `${method} ${path}`).toBe(503)
    }
  })
  it('a flood of wrong passwords from one address is rate-limited (429)', async () => {
    const h = { ...auth(USER, 'guess'), 'x-forwarded-for': '203.0.113.77' }
    const statuses: number[] = []
    for (let i = 0; i < 26; i++) statuses.push((await fetch(`${BASE}/`, { headers: h })).status)
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true)
    expect(statuses).toContain(429)
  })
})
