import { createError } from 'h3'

export const badRequest = (message: string, data?: unknown) => createError({ statusCode: 400, statusMessage: message, data })
export const unauthorized = () => createError({ statusCode: 401, statusMessage: 'تسجيل الدخول مطلوب' })
export const forbidden = (message = 'غير مصرح') => createError({ statusCode: 403, statusMessage: message })
export const notFound = (message = 'غير موجود') => createError({ statusCode: 404, statusMessage: message })
/** An administrator whose session has not passed the second factor yet (assurance level aal1 where aal2 is required). */
export const mfaRequired = () => createError({ statusCode: 403, statusMessage: 'يلزم التحقق بخطوتين للدخول إلى لوحة التحكم', data: { code: 'mfa_required' } })
export const tooMany = () => createError({ statusCode: 429, statusMessage: 'طلبات كثيرة، حاول لاحقاً' })

/** Map an error raised by one of our trusted SQL functions to an HTTP error (no internals leaked). */
export function fromDbError(err: { code?: string; message?: string } | null | undefined) {
  if (!err) return createError({ statusCode: 500, statusMessage: 'خطأ غير متوقع' })
  switch (err.code) {
    case 'AW001': {
      // publication guard: "book_not_eligible: reason_a,reason_b" -> 409 with the reason codes in `data`
      const reasons = (err.message ?? '').replace(/^book_not_eligible:\s*/, '').split(',').map((r) => r.trim()).filter(Boolean)
      return createError({ statusCode: 409, statusMessage: 'الكتاب غير مؤهل للنشر بعد', data: { code: 'book_not_eligible', reasons } })
    }
    case '42501': return forbidden(err.message)
    case 'P0002': return notFound(err.message)
    case '22023':
    case '23505': return createError({ statusCode: 409, statusMessage: err.message ?? 'تعارض' })
    default: return createError({ statusCode: 500, statusMessage: 'خطأ في قاعدة البيانات' })
  }
}
