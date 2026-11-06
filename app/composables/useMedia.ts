export const DEFAULT_COVER = '/assets/images/default-cover.webp'

/** Public image URL (public-media bucket) with the legacy default-cover fallback. Private buckets are never addressed here. */
export function useMediaUrl() {
  const base = useRuntimeConfig().public.supabase.url as string
  const publicUrl = (path: string | null | undefined, fallback = DEFAULT_COVER) =>
    path ? `${base}/storage/v1/object/public/public-media/${path}` : fallback
  return { publicUrl }
}
