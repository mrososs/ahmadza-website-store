import type { ZodType } from 'zod'

/** Same-site redirect target only (blocks open redirects like //evil.test or https://evil.test). */
export function safeRedirect(value: unknown, fallback = '/'): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback
}

/** Maps Supabase Auth errors to Arabic messages without revealing whether an account exists. */
export function authMessage(err: { message?: string; code?: string } | null): string {
  switch (err?.code) {
    case 'invalid_credentials': return 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
    case 'email_not_confirmed': return 'يرجى تأكيد بريدك الإلكتروني أولاً (راجع رسالة التأكيد)'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': return 'طلبات كثيرة، حاول لاحقاً'
    case 'weak_password': return 'كلمة المرور ضعيفة'
    case 'same_password': return 'اختر كلمة مرور مختلفة عن الحالية'
    default: return 'تعذر إتمام العملية، حاول مرة أخرى'
  }
}

/** Tiny form helper: zod validation -> field errors, plus busy / failure state. */
export function useZodForm<T extends Record<string, unknown>>(schema: ZodType<unknown>, state: T) {
  const errors = ref<Record<string, string>>({})
  const busy = ref(false)
  const failure = ref('')
  function validate(): boolean {
    const r = schema.safeParse(state)
    errors.value = r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]).reverse())
    return r.success
  }
  return { errors, busy, failure, validate }
}
