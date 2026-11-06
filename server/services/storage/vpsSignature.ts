import { createHmac, timingSafeEqual } from 'node:crypto'

// Download authorisation shared with the private media service (services/media-server/server.mjs keeps a byte-identical copy of
// this algorithm; tests/unit/media-server.test.ts fails if the two ever drift).
// token = base64url(HMAC-SHA256(secret, "GET\n<key>\n<exp>\n<downloadName>")) — bound to ONE object, ONE expiry and ONE file name.

/** Object keys the service accepts: content-addressed legacy blobs or per-upload keys. Nothing else ever reaches the filesystem. */
export const VPS_KEY_PATTERN = /^(sha256\/[0-9a-f]{2}\/[0-9a-f]{64}|books\/\d{1,12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|mp3|m4a|ogg|wav)$/

export function signDownload(secret: string, key: string, exp: number, downloadName: string): string {
  return createHmac('sha256', secret).update(`GET\n${key}\n${exp}\n${downloadName}`).digest('base64url')
}

export type VerifyResult = 'ok' | 'bad_key' | 'bad_signature' | 'expired'

/** Accepts any secret in `secrets` so a rotation can overlap (old + new). Constant-time comparison. */
export function verifyDownload(secrets: string[], p: { key: string; exp: string; dn: string; sig: string }, nowSeconds: number, maxTtlSeconds: number): VerifyResult {
  if (!VPS_KEY_PATTERN.test(p.key)) return 'bad_key'
  if (!/^\d{1,12}$/.test(p.exp) || !p.sig) return 'bad_signature'
  const given = Buffer.from(p.sig)
  let match = false
  for (const secret of secrets) {
    const expected = Buffer.from(signDownload(secret, p.key, Number(p.exp), p.dn))
    if (expected.length === given.length && timingSafeEqual(expected, given)) match = true
  }
  if (!match) return 'bad_signature'
  const exp = Number(p.exp)
  if (exp < nowSeconds) return 'expired'
  if (exp > nowSeconds + maxTtlSeconds) return 'bad_signature'
  return 'ok'
}
