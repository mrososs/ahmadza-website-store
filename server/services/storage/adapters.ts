import type { SupabaseClient } from '@supabase/supabase-js'
import { type Delivery, type DeliveryOptions, type MediaRecord, type MediaStorageAdapter, MediaUnavailableError } from './types'

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

/**
 * Client VPS storage — CONTRACT ONLY. Nothing here connects to a server or fabricates a URL.
 * The VPS phase replaces `deliver` with a call to the storage service that returns a short-lived, signed, single-purpose
 * URL for the object key (see docs/implementation/VPS_STORAGE_INTEGRATION_PLAN.md §Authorization flow).
 */
export class VpsStorageAdapter implements MediaStorageAdapter {
  readonly provider = 'vps' as const
  async deliver(): Promise<Delivery> {
    throw new MediaUnavailableError('not_implemented', 'VPS storage integration is not implemented yet')
  }
}
