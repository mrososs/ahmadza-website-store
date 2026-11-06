import type { MaybeRefOrGetter } from 'vue'

/** One canonical URL per page (the public site origin plus a path), so alternate and legacy URLs collapse to the same address in search results. */
export function useCanonical(path: MaybeRefOrGetter<string>) {
  const base = String(useRuntimeConfig().public.siteUrl).replace(/\/$/, '')
  const url = computed(() => base + toValue(path))
  useHead({ link: [{ rel: 'canonical', href: url }] })
  useSeoMeta({ ogUrl: url })
}
