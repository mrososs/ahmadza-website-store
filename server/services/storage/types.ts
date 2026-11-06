// Media storage contract. Book metadata and purchase entitlements live in Supabase; the physical bytes live in a
// storage backend selected per media row (`book_media.storage_provider`). Authorisation (is this user allowed this
// file?) is decided by the Nitro route BEFORE an adapter is asked to produce a delivery.
// See docs/implementation/VPS_STORAGE_INTEGRATION_PLAN.md.

export type MediaProvider = 'none' | 'supabase' | 'vps' | 'external'
export type MediaMigrationStatus = 'pending' | 'staged' | 'available' | 'missing' | 'rejected'

/** The only fields an adapter ever sees. `storage_path` is a provider-relative OBJECT KEY, never a user-supplied path. */
export interface MediaRecord {
  id: number
  book_id: number
  name: string
  extension: string | null
  storage_provider: MediaProvider
  storage_path: string | null
  external_url: string | null
  migration_status: MediaMigrationStatus
}

export interface DeliveryOptions {
  /** lifetime of a signed/authorised delivery, seconds */
  ttlSeconds: number
  /** suggested file name for Content-Disposition */
  downloadName: string
}

/** A delivery is always a short-lived redirect target: Nuxt never proxies private bytes and never serves them from public/. */
export interface Delivery {
  kind: 'redirect'
  url: string
}

export type UnavailableReason =
  | 'pending'            // metadata exists, the file has not been migrated/verified yet
  | 'provider_disabled'  // the backend for this row is not enabled in this environment
  | 'not_implemented'    // adapter exists as a contract only (VPS phase)
  | 'object_missing'     // backend could not produce the object
  | 'invalid_source'     // stored location is not acceptable (e.g. external URL not https)

/** Thrown instead of pretending success. The route maps it to a safe 503 (or 404 for invalid_source). */
export class MediaUnavailableError extends Error {
  constructor(public readonly reason: UnavailableReason, message?: string) {
    super(message ?? reason)
    this.name = 'MediaUnavailableError'
  }
}

export interface MediaStorageAdapter {
  readonly provider: Exclude<MediaProvider, 'none'>
  /** Produce an authorised delivery for an already-authorised request, or throw MediaUnavailableError. */
  deliver(media: MediaRecord, options: DeliveryOptions): Promise<Delivery>
}
