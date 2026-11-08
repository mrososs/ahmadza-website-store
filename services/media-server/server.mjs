// AAWRAQ private media service — serves book PDFs/audio only against a short-lived HMAC authorisation issued by the Nuxt server.
// Zero dependencies (Node >= 20). Listens on loopback by default; TLS is terminated by the reverse proxy in front of it.
// Contract: docs/implementation/VPS_STORAGE_INTEGRATION_PLAN.md §2. Deployment gate: docs/implementation/VPS_SECURITY_GATE.md.
import http from 'node:http'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// --- signature: byte-identical algorithm to server/services/storage/vpsSignature.ts (a unit test guards against drift) -----------------
export const KEY_PATTERN = /^(sha256\/[0-9a-f]{2}\/[0-9a-f]{64}|books\/\d{1,12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|mp3|m4a|ogg|wav)$/
const sign = (secret, key, exp, dn) => createHmac('sha256', secret).update(`GET\n${key}\n${exp}\n${dn}`).digest('base64url')

function verify(secrets, { key, exp, dn, sig }, nowSec, maxTtl) {
  if (!KEY_PATTERN.test(key)) return 'bad_key'
  if (!/^\d{1,12}$/.test(exp) || !sig) return 'bad_signature'
  const given = Buffer.from(sig)
  let match = false
  for (const s of secrets) {
    const expected = Buffer.from(sign(s, key, Number(exp), dn))
    if (expected.length === given.length && timingSafeEqual(expected, given)) match = true
  }
  if (!match) return 'bad_signature'
  if (Number(exp) < nowSec) return 'expired'
  if (Number(exp) > nowSec + maxTtl) return 'bad_signature'
  return 'ok'
}

const MIME = { pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav' }

/** Magic-byte allow-list for uploads (same families as the Nuxt admin upload). */
function magicOk(ext, h) {
  if (ext === 'pdf') return h.subarray(0, 4).toString('latin1') === '%PDF'
  if (ext === 'ogg') return h.subarray(0, 4).toString('latin1') === 'OggS'
  if (ext === 'wav') return h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WAVE'
  if (ext === 'm4a') return h.subarray(4, 8).toString('latin1') === 'ftyp'
  if (ext === 'mp3') return h.subarray(0, 3).toString('latin1') === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)
  return false
}

export function configFromEnv(env = process.env) {
  const secrets = String(env.MEDIA_SIGNING_SECRETS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!env.MEDIA_ROOT) throw new Error('MEDIA_ROOT is required')
  if (!secrets.length || secrets.some((s) => s.length < 32)) throw new Error('MEDIA_SIGNING_SECRETS: at least one secret, each >= 32 chars (comma-separate to rotate)')
  if (String(env.MEDIA_UPLOAD_TOKEN ?? '').length < 32) throw new Error('MEDIA_UPLOAD_TOKEN must be >= 32 chars')
  return {
    root: resolve(env.MEDIA_ROOT), secrets, uploadToken: env.MEDIA_UPLOAD_TOKEN,
    host: env.HOST ?? '127.0.0.1', port: Number(env.PORT ?? 8787),
    maxTtlSeconds: Number(env.MEDIA_MAX_TTL ?? 300), maxUploadBytes: Number(env.MEDIA_MAX_UPLOAD ?? 100 * 1024 * 1024),
    trustProxy: env.MEDIA_TRUST_PROXY === '1', getLimitPerMin: Number(env.MEDIA_GET_LIMIT ?? 120), putLimitPerMin: Number(env.MEDIA_PUT_LIMIT ?? 30),
    failLimitPerMin: Number(env.MEDIA_FAIL_LIMIT ?? 20),
    // exact origins (scheme://host[:port]) whose pages may read signed deliveries with fetch (the in-browser PDF reader); empty = no CORS at all
    allowedOrigins: String(env.MEDIA_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  }
}

export function createMediaServer(config) {
  const c = { allowedOrigins: [], maxTtlSeconds: 300, maxUploadBytes: 100 * 1024 * 1024, trustProxy: false, getLimitPerMin: 120, putLimitPerMin: 30, failLimitPerMin: 20, now: () => Date.now(), log: (l) => console.log(JSON.stringify(l)), ...config }
  const objectsDir = join(c.root, 'objects')
  const buckets = new Map()
  const sweep = setInterval(() => { const t = c.now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k) }, 60_000)
  sweep.unref()

  const hit = (id, limit) => {
    const t = c.now(); const b = buckets.get(id)
    if (!b || b.reset < t) { buckets.set(id, { n: 1, reset: t + 60_000 }); return true }
    return ++b.n <= limit
  }
  const tooMany = (id, limit) => (buckets.get(id)?.n ?? 0) >= limit && (buckets.get(id)?.reset ?? 0) >= c.now()
  const ipOf = (req) => (c.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown'
  const bearerOk = (req) => {
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))
    if (!m) return false
    const a = Buffer.from(m[1]); const b = Buffer.from(c.uploadToken)
    return a.length === b.length && timingSafeEqual(a, b)
  }
  const pathFor = (key) => {
    const p = resolve(objectsDir, key)
    if (!p.startsWith(objectsDir + sep)) throw new Error('path escape') // belt and braces: KEY_PATTERN already forbids it
    return p
  }
  const send = (res, status, body, headers = {}) => {
    const json = body === undefined ? undefined : JSON.stringify(body)
    res.writeHead(status, { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...(json ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) } : {}), ...headers })
    res.end(res.req.method === 'HEAD' ? undefined : json)
  }

  async function handle(req, res) {
    const ip = ipOf(req)
    const url = new URL(req.url ?? '/', 'http://media.invalid')
    const raw = url.pathname
    const entry = { ts: new Date(c.now()).toISOString(), ip, method: req.method, key: null, status: 0, bytes: 0 }
    res.on('finish', () => { entry.status = res.statusCode; c.log(entry) }) // never logs the query string (it carries the signature)

    if (raw === '/healthz') return send(res, 200, { ok: true })
    if (!raw.startsWith('/objects/')) return send(res, 404, { error: 'not_found' })
    const key = raw.slice('/objects/'.length) // deliberately NOT decoded: percent-escapes simply fail the pattern
    entry.key = KEY_PATTERN.test(key) ? key : '(invalid)'
    if (!KEY_PATTERN.test(key)) return send(res, 404, { error: 'not_found' })
    const ext = key.slice(key.lastIndexOf('.') + 1)
    const method = req.method

    // ---- administrative operations: bearer token, only Nuxt server code holds it ----------------------------------
    const admin = bearerOk(req)
    if (method === 'PUT' || method === 'DELETE' || (method === 'HEAD' && admin)) {
      if (!hit(`admin:${ip}`, c.putLimitPerMin * 4)) return send(res, 429, { error: 'rate_limited' })
      if (!admin) { hit(`fail:${ip}`, c.failLimitPerMin); return send(res, 401, { error: 'unauthorized' }) }
      const file = pathFor(key)
      if (method === 'HEAD') {
        const st = await stat(file).catch(() => null)
        if (!st?.isFile()) return send(res, 404)
        return send(res, 200, undefined, { 'content-length': st.size, 'x-object-sha256': key.startsWith('sha256/') ? key.split('/')[2].split('.')[0] : '' })
      }
      if (method === 'DELETE') {
        const st = await stat(file).catch(() => null)
        if (!st?.isFile()) return send(res, 404, { error: 'not_found' })
        const trash = join(c.root, 'trash', new Date(c.now()).toISOString().slice(0, 10).replaceAll('-', ''), `${randomUUID()}-${key.replaceAll('/', '_')}`)
        await mkdir(dirname(trash), { recursive: true })
        await rename(file, trash)
        return send(res, 200, { archived: true })
      }
      return put(req, res, key, ext, file)
    }

    // ---- public delivery: valid signature required --------------------------------------------------------------
    const origin = String(req.headers.origin ?? '')
    const cors = origin && c.allowedOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-expose-headers': 'content-range, accept-ranges, content-length' } : { vary: 'Origin' }
    if (method === 'OPTIONS') {
      return cors['access-control-allow-origin']
        ? send(res, 204, undefined, { ...cors, 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'range', 'access-control-max-age': '600' })
        : send(res, 403, { error: 'forbidden' })
    }
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD, PUT, DELETE' })
    if (tooMany(`fail:${ip}`, c.failLimitPerMin) || !hit(`get:${ip}`, c.getLimitPerMin)) return send(res, 429, { error: 'rate_limited' }, { 'retry-after': '60' })
    const dn = (url.searchParams.get('dn') ?? '').slice(0, 200)
    const verdict = verify(c.secrets, { key, exp: url.searchParams.get('exp') ?? '', dn, sig: url.searchParams.get('sig') ?? '' }, Math.floor(c.now() / 1000), c.maxTtlSeconds)
    if (verdict !== 'ok') { hit(`fail:${ip}`, c.failLimitPerMin); return send(res, 403, { error: verdict === 'expired' ? 'expired' : 'forbidden' }) }

    const file = pathFor(key)
    const st = await stat(file).catch(() => null)
    if (!st?.isFile()) return send(res, 404, { error: 'not_found' })
    // eslint-disable-next-line no-control-regex -- header-value sanitising: ASCII fallback name only
    const safe = (dn.replace(/[\u0000-\u001f\u007f"\\]/g, '_').replace(/[^\x20-\x7e]/g, '_') || `download.${ext}`)
    const headers = {
      ...cors, 'content-type': MIME[ext], 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      'content-disposition': `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(dn || `download.${ext}`)}`,
    }
    let start = 0; let end = st.size - 1; let status = 200
    const rh = req.headers.range
    if (rh) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(rh).trim()) // anything else (multi-range, junk) is ignored -> full 200, as RFC 9110 allows
      if (m && (m[1] || m[2])) {
        if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, st.size - n) } else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])) }
        if (start >= st.size || start > end) return send(res, 416, undefined, { ...headers, 'content-range': `bytes */${st.size}` })
        status = 206; headers['content-range'] = `bytes ${start}-${end}/${st.size}`
      }
    }
    headers['content-length'] = end - start + 1
    res.writeHead(status, headers)
    entry.bytes = end - start + 1
    if (method === 'HEAD') return res.end()
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res)
  }

  async function put(req, res, key, ext, file) {
    const claimed = String(req.headers['x-content-sha256'] ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(claimed)) return send(res, 400, { error: 'x-content-sha256 required' })
    const declared = Number(req.headers['content-length'] ?? NaN)
    if (!Number.isFinite(declared) || declared <= 0) return send(res, 411, { error: 'content-length required' })
    if (declared > c.maxUploadBytes) return send(res, 413, { error: 'too_large' })
    await mkdir(join(c.root, 'tmp'), { recursive: true })
    const tmp = join(c.root, 'tmp', randomUUID())
    const fh = await open(tmp, 'wx', 0o640)
    const hash = createHash('sha256'); let total = 0; let head = Buffer.alloc(0)
    try {
      for await (const chunk of req) {
        total += chunk.length
        if (total > c.maxUploadBytes) { await fh.close(); await unlink(tmp); return send(res, 413, { error: 'too_large' }) }
        if (head.length < 12) head = Buffer.concat([head, chunk]).subarray(0, 12)
        hash.update(chunk); await fh.write(chunk)
      }
      await fh.close()
      const digest = hash.digest('hex')
      if (digest !== claimed) { await unlink(tmp); return send(res, 422, { error: 'hash_mismatch' }) }
      if (!magicOk(ext, head)) { await unlink(tmp); return send(res, 422, { error: 'content_type_rejected' }) }
      if (key.startsWith('sha256/') && key.split('/')[2].split('.')[0] !== digest) { await unlink(tmp); return send(res, 422, { error: 'key_not_content_addressed' }) }
      await mkdir(dirname(file), { recursive: true })
      try { await link(tmp, file) } // hard link fails with EEXIST: atomic, never overwrites
      catch (e) { await unlink(tmp); if (e.code === 'EEXIST') return send(res, 409, { error: 'exists' }); throw e }
      await unlink(tmp)
      return send(res, 201, { key, sha256: digest, bytes: total })
    } catch (e) {
      await fh.close().catch(() => {}); await unlink(tmp).catch(() => {})
      throw e
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      c.log({ ts: new Date(c.now()).toISOString(), level: 'error', message: String(e?.message ?? e).slice(0, 200) })
      if (!res.headersSent) send(res, 500, { error: 'internal' }); else res.destroy()
    })
  })
  server.requestTimeout = 10 * 60_000
  server.headersTimeout = 15_000
  server.on('close', () => clearInterval(sweep))
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cfg = configFromEnv()
  createMediaServer(cfg).listen(cfg.port, cfg.host, () => console.log(JSON.stringify({ msg: 'aawraq-media listening', host: cfg.host, port: cfg.port, root: cfg.root })))
}
