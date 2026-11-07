import { describe, expect, it } from 'vitest'
import { decide, hashPassword, normaliseMode, parseBasicAuth, parsePasswordHash, verifyPassword, NOINDEX_HEADERS, type PreviewConfig } from '../../server/utils/previewGate'

const PASSWORD = 'correct horse battery staple'
const HASH = hashPassword(PASSWORD)
const basic = (user: string, pw: string) => `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`
const protectedCfg: PreviewConfig = { mode: 'protected', user: 'client', passwordHash: HASH }

describe('password hashing', () => {
  it('verifies the right password and rejects wrong, empty and near-miss ones', () => {
    expect(verifyPassword(PASSWORD, HASH)).toBe(true)
    expect(verifyPassword(PASSWORD + ' ', HASH)).toBe(false)
    expect(verifyPassword('', HASH)).toBe(false)
    expect(verifyPassword('wrong', HASH)).toBe(false)
  })
  it('uses a fresh salt every time and never contains the password', () => {
    const other = hashPassword(PASSWORD)
    expect(other).not.toBe(HASH)
    expect(HASH).not.toContain(PASSWORD)
    expect(verifyPassword(PASSWORD, other)).toBe(true)
  })
  it('refuses malformed or weak stored hashes instead of accepting them', () => {
    for (const bad of ['', 'plain-text', 'scrypt$16384$8$1$$', 'md5$1$1$1$YQ==$YQ==', 'scrypt$2$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2g=', 'scrypt$16384$8$1$YQ==$YQ==']) {
      expect(parsePasswordHash(bad)).toBeNull()
      expect(verifyPassword(PASSWORD, bad)).toBe(false)
    }
  })
})

describe('parseBasicAuth', () => {
  it('parses well-formed headers, including a colon inside the password', () => {
    expect(parseBasicAuth(basic('u', 'p:a:ss'))).toEqual({ user: 'u', password: 'p:a:ss' })
  })
  it('rejects other schemes and garbage', () => {
    for (const h of [undefined, null, '', 'Bearer abc', 'Basic', 'Basic !!!', `Basic ${Buffer.from('nocolon').toString('base64')}`]) expect(parseBasicAuth(h as string)).toBeNull()
  })
})

describe('mode selection fails closed', () => {
  it('defaults to protected in production and open elsewhere; unknown values never open production', () => {
    expect(normaliseMode(undefined, true)).toBe('protected')
    expect(normaliseMode('', true)).toBe('protected')
    expect(normaliseMode('true', true)).toBe('protected')
    expect(normaliseMode(' OPEN ', true)).toBe('open') // only the explicit word opens it
    expect(normaliseMode(undefined, false)).toBe('open')
    expect(normaliseMode('protected', false)).toBe('protected')
  })
})

describe('gate decisions (protected)', () => {
  const at = (path: string, authorization?: string) => decide({ config: protectedCfg, path, authorization })

  it('challenges anonymous requests everywhere, pages, assets and API alike', () => {
    for (const p of ['/', '/book/2', '/admin', '/api/admin/books', '/_nuxt/entry.js', '/sitemap.xml']) expect(at(p)).toEqual({ action: 'challenge', failedAttempt: false })
  })
  it('flags wrong credentials as failed attempts (rate-limited by the middleware) and still serves nothing', () => {
    expect(at('/', basic('client', 'nope'))).toEqual({ action: 'challenge', failedAttempt: true })
    expect(at('/', basic('someone', PASSWORD))).toEqual({ action: 'challenge', failedAttempt: true })
  })
  it('allows valid credentials and adds the no-index / no-store headers', () => {
    const d = at('/book/2', basic('client', PASSWORD))
    expect(d).toEqual({ action: 'allow', headers: { ...NOINDEX_HEADERS } })
    expect((d as { headers: Record<string, string> }).headers['x-robots-tag']).toMatch(/noindex/)
  })
  it('even for a valid user, checkout, payment webhooks and downloads are switched off', () => {
    for (const p of ['/api/checkout/session', '/api/checkout/simulate/x', '/api/webhooks/payments/paymob', '/api/library/download/12']) {
      expect(at(p, basic('client', PASSWORD))).toMatchObject({ action: 'deny', status: 503 })
    }
    // prefix tricks do not slip through, and look-alikes are not blocked by mistake
    expect(at('/api/checkout', basic('client', PASSWORD))).toMatchObject({ action: 'deny' })
    expect(at('/api/checkouts', basic('client', PASSWORD))).toMatchObject({ action: 'allow' })
    expect(at('/api/library/download/12?x=1', basic('client', PASSWORD))).toMatchObject({ action: 'deny' })
  })
  it('the list of payment methods is the one exception inside the checkout prefix: reachable with the password, still challenged without it, nothing else under it', () => {
    expect(at('/api/checkout/methods', basic('client', PASSWORD))).toEqual({ action: 'allow', headers: { ...NOINDEX_HEADERS } })
    expect(at('/api/checkout/methods/', basic('client', PASSWORD))).toMatchObject({ action: 'allow' })
    expect(at('/api/checkout/methods')).toEqual({ action: 'challenge', failedAttempt: false })
    for (const p of ['/api/checkout/methods/x', '/api/checkout/methodsX', '/api/checkout/session']) expect(at(p, basic('client', PASSWORD))).toMatchObject({ action: 'deny', status: 503 })
  })
  it('anonymous requests to blocked flows are challenged, not told that the route exists', () => {
    expect(at('/api/checkout/session')).toEqual({ action: 'challenge', failedAttempt: false })
  })
  it('serves a disallow-all robots.txt without credentials', () => {
    expect(at('/robots.txt')).toEqual({ action: 'robots' })
  })
})

describe('fail closed', () => {
  it('a protected site without credentials, or with an unusable hash, serves nothing (503) — even for a request that carries a password', () => {
    for (const cfg of [{ mode: 'protected', user: '', passwordHash: HASH }, { mode: 'protected', user: 'client', passwordHash: '' }, { mode: 'protected', user: 'client', passwordHash: 'garbage' }] as PreviewConfig[]) {
      expect(decide({ config: cfg, path: '/', authorization: basic('client', PASSWORD) })).toMatchObject({ action: 'deny', status: 503 })
      expect(decide({ config: cfg, path: '/api/admin/books' })).toMatchObject({ action: 'deny', status: 503 })
    }
  })
  it('open mode changes nothing', () => {
    expect(decide({ config: { mode: 'open', user: '', passwordHash: '' }, path: '/api/checkout/session' })).toEqual({ action: 'allow', headers: {} })
  })
})
