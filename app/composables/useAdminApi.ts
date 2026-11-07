// Thin helpers for the admin area. All data goes through /api/admin/** (server checks the role on every call).
import type { LocationQueryValue } from 'vue-router'
import { readinessReasonLabel } from '~~/shared/constants/recovery'

export function adminErrorMessage(e: unknown, fallback = 'حدث خطأ غير متوقع'): string {
  const err = e as { data?: { statusMessage?: string; message?: string; data?: { reasons?: string[] } }; statusMessage?: string; message?: string } | null
  const base = err?.data?.statusMessage ?? err?.statusMessage ?? err?.data?.message ?? fallback
  // a refused publication carries the machine reasons; show them in plain Arabic
  const reasons = err?.data?.data?.reasons
  return Array.isArray(reasons) && reasons.length ? `${base}: ${reasons.map(readinessReasonLabel).join('، ')}` : base
}

/** $fetch wrapper that throws an Error with a user-facing Arabic message. */
export async function adminFetch<T = unknown>(url: string, opts: Parameters<typeof $fetch>[1] = {}): Promise<T> {
  try {
    return (await $fetch(url, opts)) as T
  } catch (e) {
    const status = (e as { statusCode?: number; status?: number }).statusCode ?? (e as { status?: number }).status
    const code = (e as { data?: { data?: { code?: string } } }).data?.data?.code
    if (code === 'mfa_required') await navigateTo('/admin/security') // password passed, second factor not yet
    else if (status === 401 || status === 403) await navigateTo('/admin/login')
    throw new Error(adminErrorMessage(e))
  }
}

/** After a failed client-side validation: bring the first field error into view (the forms are long, especially on a phone). */
export async function scrollToFirstError() {
  await nextTick()
  document.querySelector('.text-danger[role="alert"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function useAdminTitle(title: MaybeRefOrGetter<string>) {
  const state = useState<string>('admin-title', () => '')
  watchEffect(() => { state.value = toValue(title) })
  useHead({ title: () => toValue(title) })
}

const first = (v: LocationQueryValue | LocationQueryValue[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** Server-paginated list: page / q / status live in the URL (shareable, back-button friendly). */
export function useAdminList<T>(endpoint: string, extraQuery: () => Record<string, string | undefined> = () => ({})) {
  const route = useRoute()
  const query = computed(() => ({
    page: String(Math.max(1, Number(first(route.query.page)) || 1)),
    q: first(route.query.q),
    status: first(route.query.status) || 'all',
    ...extraQuery(),
  }))
  const { data, pending, error, refresh } = useFetch<{ items: T[]; total: number; page: number; pageSize: number }>(endpoint, {
    query, server: false, key: `${endpoint}:${JSON.stringify(query.value)}`, watch: [query],
  })
  const errorText = computed(() => (error.value ? adminErrorMessage(error.value) : ''))
  return { data, pending, error, errorText, refresh, query }
}

export const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  published: { label: 'مفعلة', cls: 'badge-success' },
  draft: { label: 'غير مفعلة', cls: 'badge-danger' },
  coming_soon: { label: 'قريباً', cls: 'badge-warning' },
  archived: { label: 'مؤرشفة', cls: 'badge-secondary' },
}

export const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : '')
export const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '')
