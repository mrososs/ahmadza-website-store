import type { SupabaseClient } from '@supabase/supabase-js'
import { type Delivery, type DeliveryOptions, type MediaRecord, type MediaStorageAdapter, MediaUnavailableError } from './types'
import { signDownload, VPS_KEY_PATTERN } from './vpsSignature'

/** Supabase Storage (private bucket `private-products`): used in local development; disabled by default in hosted environments. */
export class SupabaseStorageAdapter implements MediaStorageAdapter {
  readonly provider = 'supabase' as const
  constructor(private readonly db: SupabaseClient, private readonly bucket = 'private-products') {}

  async deliver(media: MediaRecord, options: DeliveryOptions): Promise<Delivery> {
    if (!media.storage_path) throw new MediaUnavailableError('pending', 'no object key')
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUrl(media.storage_path, options.ttlSeconds, { download: options.downloadName })
    if (error || !data?.signedUrl) throw new MediaUnavailableError('object_missing', error?.message)
    return { kind: 'redirect', url: data.signedUrl }
  }
}

/** External https link entered by an administrator (legacy `external = 1`). Never redirects to a non-https URL. */
export class ExternalLinkAdapter implements MediaStorageAdapter {
  readonly provider = 'external' as const
  async deliver(media: MediaRecord): Promise<Delivery> {
    let url: URL | null = null
    try { url = new URL(media.external_url ?? '') } catch { /* handled below */ }
    if (!url || url.protocol !== 'https:') throw new MediaUnavailableError('invalid_source', 'external url must be https')
    return { kind: 'redirect', url: url.toString() }
  }
}

export interface VpsStorageConfig {
  /** https://… of the private media service (http only for loopback development) */
  baseUrl: string
  /** shared HMAC secret for download links (server-only) */
  signingSecret: string
  /** bearer token for PUT/HEAD/DELETE (server-only; never sent to a browser) */
  uploadToken: string
}

export interface VpsObjectInfo { exists: boolean; bytes?: number; sha256?: string }

/**
 * Private media service (services/media-server). Bytes never pass through Nuxt on download: after the route has authorised the
 * request, `deliver` verifies the object exists and returns a short-lived, single-object signed URL (docs/implementation/VPS_STORAGE_INTEGRATION_PLAN.md §4).
 * Object keys come only from `book_media.storage_path` or from server code — never from the browser.
 */
export class VpsStorageAdapter implements MediaStorageAdapter {
  readonly provider = 'vps' as const
  private readonly base: string

  constructor(private readonly cfg: VpsStorageConfig, private readonly nowMs: () => number = Date.now, private readonly timeoutMs = 5000) {
    let url: URL | null = null
    try { url = new URL(cfg.baseUrl) } catch { /* handled below */ }
    const loopback = url && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (!url || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new MediaUnavailableError('provider_disabled', 'vps base url must be https')
    if (cfg.signingSecret.length < 32 || cfg.uploadToken.length < 32) throw new MediaUnavailableError('provider_disabled', 'vps secrets are not configured')
    this.base = url.origin + url.pathname.replace(/\/+$/, '')
  }

  private objectUrl(key: string) {
    if (!VPS_KEY_PATTERN.test(key)) throw new MediaUnavailableError('invalid_source', 'object key rejected')
    return `${this.base}/objects/${key}`
  }

  private auth() { return { authorization: `Bearer ${this.cfg.uploadToken}` } }

  async head(key: string): Promise<VpsObjectInfo> {
    const res = await fetch(this.objectUrl(key), { method: 'HEAD', headers: this.auth(), signal: AbortSignal.timeout(this.timeoutMs) })
    if (res.status === 404) return { exists: false }
    if (!res.ok) throw new MediaUnavailableError('object_missing', `storage service answered ${res.status}`)
    return { exists: true, bytes: Number(res.headers.get('content-length') ?? 0), sha256: res.headers.get('x-object-sha256') ?? undefined }
  }

  /** Upload; the service recomputes the hash and refuses to overwrite. Returns only after the service confirmed the same SHA-256. */
  async put(key: string, bytes: Uint8Array, sha256: string): Promise<{ key: string; sha256: string; bytes: number }> {
    const res = await fetch(this.objectUrl(key), {
      method: 'PUT', headers: { ...this.auth(), 'x-content-sha256': sha256, 'content-type': 'application/octet-stream' },
      body: bytes as unknown as BodyInit, signal: AbortSignal.timeout(this.timeoutMs * 12),
    })
    const body = await res.json().catch(() => null) as { sha256?: string; bytes?: number } | null
    if (!res.ok || body?.sha256 !== sha256) throw new MediaUnavailableError('object_missing', `upload refused (${res.status})`)
    return { key, sha256, bytes: Number(body.bytes ?? bytes.byteLength) }
  }

  /** Soft delete: the service moves the object to trash/, it is never unlinked. */
  async archive(key: string): Promise<void> {
    const res = await fetch(this.objectUrl(key), { method: 'DELETE', headers: this.auth(), signal: AbortSignal.timeout(this.timeoutMs) })
    if (!res.ok && res.status !== 404) throw new MediaUnavailableError('object_missing', `archive refused (${res.status})`)
  }

  async deliver(media: MediaRecord, options: DeliveryOptions): Promise<Delivery> {
    if (!media.storage_path) throw new MediaUnavailableError('pending', 'no object key')
    const url = this.objectUrl(media.storage_path)
    let info: VpsObjectInfo
    try { info = await this.head(media.storage_path) } catch (e) {
      if (e instanceof MediaUnavailableError) throw e
      throw new MediaUnavailableError('object_missing', 'storage service unreachable')
    }
    if (!info.exists) throw new MediaUnavailableError('object_missing', 'object not found')
    // eslint-disable-next-line no-control-regex -- stripping control characters from a header value is the point
    const dn = options.downloadName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200)
    const exp = Math.floor(this.nowMs() / 1000) + options.ttlSeconds
    const sig = signDownload(this.cfg.signingSecret, media.storage_path, exp, dn)
    return { kind: 'redirect', url: `${url}?${new URLSearchParams({ exp: String(exp), dn, sig })}` }
  }
}
