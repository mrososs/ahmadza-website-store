// The owner reviewed ONE recovered book and confirms it is genuine. Verification alone publishes nothing: the database still demands a valid price,
// a validated file and (for legacy records) a publishable original status before the book can go live.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  const { data, error } = await serviceClient(event).rpc('verify_book', { p_book: id, p_admin: admin.id })
  if (error) dbFail(error)
  if (!data) throw notFound('هذا الكتاب ليس سجلاً مستعاداً أو غير موجود')
  await adminAudit(event, admin, 'recovery.verify_book', 'books', id)
  return { verified: true }
})
