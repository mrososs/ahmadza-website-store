import { notFound } from '../../../../../utils/errors'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const bookId = intParam(event, 'id'), mediaId = intParam(event, 'mediaId')
  const db = serviceClient(event)
  const { data: m } = await db.from('book_media').select('id,storage_path').eq('id', mediaId).eq('book_id', bookId).maybeSingle()
  if (!m) throw notFound()
  const { error } = await db.from('book_media').delete().eq('id', mediaId)
  if (error) dbFail(error)
  if (m.storage_path) await db.storage.from('private-products').remove([m.storage_path])
  await adminAudit(event, admin, 'media_delete', 'book_media', mediaId, { book_id: bookId })
  return { ok: true }
})
