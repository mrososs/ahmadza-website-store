import { adminMediaUpdateSchema } from '~~/shared/schemas/admin'
import { notFound } from '../../../../../utils/errors'

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const bookId = intParam(event, 'id'), mediaId = intParam(event, 'mediaId')
  const patch = await parseBody(event, adminMediaUpdateSchema)
  const { data, error } = await serviceClient(event).from('book_media').update(patch).eq('id', mediaId).eq('book_id', bookId).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound()
  await adminAudit(event, admin, 'media_update', 'book_media', mediaId)
  return { ok: true }
})
