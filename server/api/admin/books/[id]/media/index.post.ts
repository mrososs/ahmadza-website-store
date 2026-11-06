import { randomUUID } from 'node:crypto'
import { getRequestHeader } from 'h3'
import { adminExternalMediaSchema } from '~~/shared/schemas/admin'
import { badRequest, notFound } from '../../../../../utils/errors'
import { countPdfPages, readAdminUpload } from '../../../../../utils/adminUpload'

const MAX_MEDIA_BYTES = 100 * 1024 * 1024 // = private-products bucket limit

// Two modes: JSON {external_url,...} (https only) or multipart (file + visibility/name/sort_order) -> private-products.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const bookId = intParam(event, 'id')
  const db = serviceClient(event)
  const { data: book } = await db.from('books').select('id').eq('id', bookId).maybeSingle()
  if (!book) throw notFound('الكتاب غير موجود')

  const isMultipart = (getRequestHeader(event, 'content-type') ?? '').startsWith('multipart/form-data')
  if (!isMultipart) {
    const ext = await parseBody(event, adminExternalMediaSchema)
    const { data, error } = await db.from('book_media').insert({
      book_id: bookId, kind: ext.kind, visibility: ext.visibility, name: ext.name, sort_order: ext.sort_order,
      is_external: true, external_url: ext.external_url,
    }).select('id').single()
    if (error) dbFail(error)
    await adminAudit(event, admin, 'media_external_add', 'book_media', data.id, { book_id: bookId })
    setResponseStatus(event, 201)
    return data
  }

  const up = await readAdminUpload(event, { groups: ['pdf', 'audio'], maxBytes: MAX_MEDIA_BYTES })
  const rawVis = up.fields.visibility
  const visibility = !rawVis || rawVis === 'after_purchase' ? 'after_purchase' : rawVis === 'preview' ? 'preview' : null
  if (!visibility) throw badRequest('قيمة visibility غير صالحة')
  const name = (up.fields.name ?? '').trim().slice(0, 200) || (up.sniffed.group === 'pdf' ? 'ملف الكتاب' : 'ملف صوتي')
  const sortOrder = Math.max(0, Math.min(100000, parseInt(up.fields.sort_order ?? '0', 10) || 0))
  const path = `books/${bookId}/${randomUUID()}.${up.sniffed.ext}`
  const { error: upErr } = await db.storage.from('private-products').upload(path, up.buffer, { contentType: up.sniffed.mime, upsert: false })
  if (upErr) throw badRequest('تعذر رفع الملف')
  const pages = up.sniffed.group === 'pdf' ? countPdfPages(up.buffer) : 0
  const { data, error } = await db.from('book_media').insert({
    book_id: bookId, kind: up.sniffed.group === 'pdf' ? 'file' : 'audio', visibility, name, extension: up.sniffed.ext, page_count: pages,
    sort_order: sortOrder, storage_path: path, mime_type: up.sniffed.mime, byte_size: up.size, sha256: up.sha256,
  }).select('id').single()
  if (error) { await db.storage.from('private-products').remove([path]); dbFail(error) }
  if (pages) {
    const { data: all } = await db.from('book_media').select('page_count').eq('book_id', bookId).eq('kind', 'file')
    await db.from('books').update({ pages: (all ?? []).reduce((s, m) => s + (m.page_count ?? 0), 0) }).eq('id', bookId)
  }
  await adminAudit(event, admin, 'media_upload', 'book_media', data.id, { book_id: bookId, sha256: up.sha256, size: up.size })
  setResponseStatus(event, 201)
  return data
})
