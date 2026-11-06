// Helpers shared by the affiliate / contributor / admin-partner pages (names prefixed to avoid clashes with other slices).

export const partnerMoney = (n: number | string | null | undefined, currency = 'USD') => `${Number(n ?? 0).toFixed(2)} ${currency}`

export const partnerDate = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : '-')
export const partnerDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 16).replace('T', ' ') : '-')

/** Arabic message from a failed $fetch / server error. */
export function partnerErrorMessage(e: unknown): string {
  const err = e as { statusMessage?: string; data?: { statusMessage?: string; message?: string }; statusCode?: number }
  return err?.data?.statusMessage || err?.statusMessage || err?.data?.message || 'حدث خطأ غير متوقع'
}

/** Commission / ledger availability is derived from available_at (no cron / exact-date match like the legacy job). */
export const partnerIsAvailable = (availableAt: string) => new Date(availableAt).getTime() <= Date.now()

export const WITHDRAW_BADGE = {
  pending: { cls: 'badge-warning', label: 'قيد الانتظار' },
  paid: { cls: 'badge-success', label: 'تم الارسال' },
  rejected: { cls: 'badge-danger', label: 'فشل' },
} as const

export const ACCOUNT_STATUS_BADGE = {
  active: { cls: 'badge-success', label: 'مفعل' },
  review: { cls: 'badge-warning', label: 'تحت المراجعة' },
  banned: { cls: 'badge-danger', label: 'محظور' },
} as const

/** Redirect non-affiliates to the registration page when a partner API answers 403. */
export async function usePartnerFetch<T>(url: string, opts: { redirectOn403?: boolean } = {}) {
  try {
    return await $fetch<T>(url)
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode
    if (code === 403 && opts.redirectOn403) { await navigateTo('/affiliate-register'); return null }
    if (code === 401) { await navigateTo('/login'); return null }
    throw e
  }
}
