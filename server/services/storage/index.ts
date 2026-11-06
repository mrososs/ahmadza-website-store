import type { H3Event } from 'h3'
import { ExternalLinkAdapter, SupabaseStorageAdapter, VpsStorageAdapter } from './adapters'
import { type Delivery, type DeliveryOptions, type MediaProvider, type MediaRecord, type MediaStorageAdapter, MediaUnavailableError } from './types'

export * from './types'

/** Providers enabled in THIS environment: NUXT_MEDIA_ENABLED_PROVIDERS (comma list). Hosted default = external only. */
export function enabledMediaProviders(event: H3Event): Set<MediaProvider> {
  const raw = String(useRuntimeConfig(event).mediaEnabledProviders ?? '')
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean) as MediaProvider[])
}

export function isProviderEnabled(event: H3Event, provider: MediaProvider): boolean {
  return enabledMediaProviders(event).has(provider)
}

/** VPS adapter from server-only runtime config; throws MediaUnavailableError('provider_disabled') when it is not configured. */
export function createVpsStorage(event: H3Event) {
  const cfg = useRuntimeConfig(event)
  return new VpsStorageAdapter({
    baseUrl: String(cfg.vpsStorageBaseUrl ?? ''),
    signingSecret: String(cfg.vpsStorageSigningSecret ?? ''),
    uploadToken: String(cfg.vpsStorageUploadToken ?? ''),
  })
}

/** Resolve the adapter for a media row, or fail safely. Never falls back to another backend or to a public path. */
export function createMediaStorage(event: H3Event) {
  const adapters: Record<string, () => MediaStorageAdapter> = {
    supabase: () => new SupabaseStorageAdapter(serviceClient(event)),
    external: () => new ExternalLinkAdapter(),
    vps: () => createVpsStorage(event),
  }
  return {
    async deliver(media: MediaRecord, options: DeliveryOptions): Promise<Delivery> {
      if (media.migration_status !== 'available') throw new MediaUnavailableError('pending', `media is ${media.migration_status}`)
      const make = adapters[media.storage_provider]
      if (!make) throw new MediaUnavailableError('pending', 'no storage backend assigned yet')
      if (!isProviderEnabled(event, media.storage_provider)) throw new MediaUnavailableError('provider_disabled', `${media.storage_provider} is not enabled here`)
      return make().deliver(media, options)
    },
  }
}
