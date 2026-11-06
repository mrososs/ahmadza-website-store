// Administrator two-step verification, end to end: a real server with NUXT_ADMIN_REQUIRE_MFA=true against the LOCAL Supabase Auth.
// A password-only (aal1) admin session is refused by every /api/admin route except /me; after a real TOTP enrolment and verification (aal2) it is allowed;
// a fresh password sign-in is aal1 again. The dev admin is left exactly as found (the factor is removed).
import { createHmac } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEV_USERS, serviceClient, sessionCookieHeader, signedInClient } from '../helpers/supabase'

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PORT = 3192
const BASE = `http://localhost:${PORT}`
const svc = serviceClient()
let app: ChildProcess | undefined
let log = ''

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret: what an authenticator app computes. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0')
}
const api = (path: string, cookie: string) => fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' })
const adminUserId = async () => (await signedInClient(DEV_USERS.admin)).userId

async function removeAllFactors() {
  const id = await adminUserId()
  const { data } = await svc.auth.admin.mfa.listFactors({ userId: id })
  for (const f of data?.factors ?? []) await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId: id })
}

beforeAll(async () => {
  await removeAllFactors()
  app = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['nuxt', 'dev', '--port', String(PORT), '--extends', './scripts/dev/recovery-layer'], {
    cwd: ROOT, shell: process.platform === 'win32', env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1', NUXT_ADMIN_REQUIRE_MFA: 'true' },
  })
  app.stdout?.on('data', (d) => { log += String(d) }); app.stderr?.on('data', (d) => { log += String(d) })
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${BASE}/robots.txt`)).status === 200) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`server did not start:\n${log.slice(-1500)}`)
}, 240_000)

afterAll(async () => {
  await removeAllFactors().catch(() => undefined)
  if (app?.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F']); else app.kill('SIGTERM') }
})

describe('administrator second factor', () => {
  it('a password-only admin session is refused by the admin API with mfa_required, but /me answers so the UI knows where to go', async () => {
    const { client } = await signedInClient(DEV_USERS.admin)
    const cookie = sessionCookieHeader((await client.auth.getSession()).data.session!)
    for (const path of ['/api/admin/books', '/api/admin/orders', '/api/admin/payments', '/api/admin/recovery/summary', '/api/admin/dashboard']) {
      const r = await api(path, cookie)
      expect(r.status, path).toBe(403)
      expect((await r.json()).data.code, path).toBe('mfa_required')
    }
    const me = await api('/api/admin/me', cookie)
    expect(me.status).toBe(200)
    expect((await me.json()).mfa).toMatchObject({ required: true, aal: 'aal1', satisfied: false })
  })

  it('after enrolling an authenticator and entering a correct code the same admin gets in; a wrong code does not', async () => {
    const { client } = await signedInClient(DEV_USERS.admin)
    const enrol = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'test-authenticator' })
    expect(enrol.error).toBeNull()
    const { id, totp: t } = enrol.data!
    expect(t.qr_code).toMatch(/^data:image\/svg\+xml/)

    const wrong = await client.auth.mfa.challengeAndVerify({ factorId: id, code: '000000' })
    expect(wrong.error).toBeTruthy()
    expect((await api('/api/admin/books', sessionCookieHeader((await client.auth.getSession()).data.session!))).status).toBe(403)

    const ok = await client.auth.mfa.challengeAndVerify({ factorId: id, code: totp(t.secret) })
    expect(ok.error).toBeNull()
    const session = (await client.auth.getSession()).data.session!
    const cookie = sessionCookieHeader(session)
    const books = await api('/api/admin/books', cookie)
    expect(books.status).toBe(200)
    expect((await (await api('/api/admin/me', cookie)).json()).mfa).toMatchObject({ aal: 'aal2', satisfied: true })

    // a brand-new password sign-in is aal1 again: the earlier second factor does not carry over
    const fresh = await signedInClient(DEV_USERS.admin)
    const freshCookie = sessionCookieHeader((await fresh.client.auth.getSession()).data.session!)
    expect((await api('/api/admin/books', freshCookie)).status).toBe(403)
    const aal = await fresh.client.auth.mfa.getAuthenticatorAssuranceLevel()
    expect(aal.data).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal2' })

    // removing the factor needs the second factor itself
    expect((await fresh.client.auth.mfa.unenroll({ factorId: id })).error).toBeTruthy()
    expect((await client.auth.mfa.unenroll({ factorId: id })).error).toBeNull()
  })

  it('customers and guests are still refused exactly as before (no information about MFA)', async () => {
    const { client } = await signedInClient(DEV_USERS.customer)
    const cookie = sessionCookieHeader((await client.auth.getSession()).data.session!)
    const r = await api('/api/admin/books', cookie)
    expect(r.status).toBe(403)
    expect((await r.json()).data?.code).toBeUndefined()
    expect((await api('/api/admin/books', '')).status).toBe(401)
  })
})
