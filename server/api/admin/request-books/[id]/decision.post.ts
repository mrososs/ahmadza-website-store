import { adminDecisionSchema } from '~~/shared/schemas/affiliate'
import { badRequest, fromDbError, notFound } from '../../../../utils/errors'
import { requireAdmin, serviceClient } from '../../../../utils/supabase'

// Approve -> approve_contributor_request() creates ONE draft book owned by the contributor (publishing stays a separate
// admin action). The submitted PDF / cover are then copied (best effort) into the proper buckets for that draft book.
// Decline -> decline_contributor_request(). Both are idempotency-guarded in SQL (a second call fails with 409).
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound()
  const parsed = adminDecisionSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('بيانات غير صالحة')
  const db = serviceClient(event)

  if (!parsed.data.approve) {
    const { error } = await db.rpc('decline_contributor_request', { p_request: id, p_admin: admin.id, p_note: parsed.data.note ?? undefined })
    if (error) throw fromDbError(error)
    return { ok: true, status: 'declined' }
  }

  const { data: bookId, error } = await db.rpc('approve_contributor_request', { p_request: id, p_admin: admin.id, p_note: parsed.data.note ?? undefined })
  if (error) throw fromDbError(error)

  const warnings: string[] = []
  const { data: r } = await db.from('contributor_requests').select('book_path,cover_path').eq('id', id).maybeSingle()
  if (r?.book_path) {
    const dest = `books/${bookId}/contributor-${id}.pdf`
    const { error: cpErr } = await db.storage.from('private-sensitive').copy(r.book_path, dest, { destinationBucket: 'private-products' })
    if (cpErr) warnings.push('تعذر نسخ ملف الكتاب')
    else {
      await db.from('book_media').insert({
        book_id: bookId as number, kind: 'file', visibility: 'after_purchase', name: 'ملف الكتاب', extension: 'pdf',
        storage_path: dest, mime_type: 'application/pdf',
      })
    }
  }
  if (r?.cover_path) {
    const ext = r.cover_path.split('.').pop()
    const dest = `covers/contributor-${bookId}.${ext}`
    const { error: cpErr } = await db.storage.from('private-sensitive').copy(r.cover_path, dest, { destinationBucket: 'public-media' })
    if (cpErr) warnings.push('تعذر نسخ الغلاف')
    else await db.from('books').update({ cover_path: dest }).eq('id', bookId as number)
  }
  return { ok: true, status: 'approved', bookId, warnings }
})
