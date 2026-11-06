import { z } from 'zod'

// Free-access workflow: a signed-in customer adds a genuinely free, published book to their library. No order, payment, invoice or commission is created
// (claim_free_book is the only writer), the book is validated in the database, and claiming again is a no-op that never undoes an administrator's revocation.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  rateLimit(event, 'claim-free', 30, 60_000)
  const parsed = z.object({ bookId: z.number().int().positive() }).safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('طلب غير صالح')
  const { data, error } = await serviceClient(event).rpc('claim_free_book', { p_user: user.id, p_book: parsed.data.bookId })
  if (error) {
    if (error.code === '22023') throw createError({ statusCode: 409, statusMessage: 'هذا الكتاب غير متاح كمجاني' })
    if (error.code === '42501') throw forbidden('هذا الحساب غير مسموح له بإضافة كتب حالياً')
    throw fromDbError(error)
  }
  return { claimed: data === true }
})
