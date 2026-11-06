/** Public image URL (public-media bucket) with the legacy default-cover fallback. Private buckets are never addressed here. */
export function useMediaUrl() {
  const base = useRuntimeConfig().public.supabase.url as string
  const publicUrl = (path: string | null | undefined, fallback = '/assets/images/default-cover.webp') =>
    path ? `${base}/storage/v1/object/public/public-media/${path}` : fallback
  return { publicUrl }
}
