import { idSchema } from '~~/shared/schemas'

// Secure delivery of book files (legacy AUTH-19 / ORD-17, rebuilt):
//  - preview media of a published book: everyone
//  - after_purchase media: free book (open to guests), OR an active entitlement, OR an admin
//  - paid files live in the PRIVATE bucket and are only ever handed out as short-lived signed URLs (302); storage paths are never returned.
export default defineEventHandler(async (event) => {
  rateLimit(event, 'download', 60, 60_000)
  const parsed = idSchema.safeParse(getRouterParam(event, 'mediaId'))
  if (!parsed.success) throw badRequest('معرّف غير صالح')
  const db = serviceClient(event)

  const { data: media } = await db.from('book_media')
    .select('id,book_id,visibility,is_external,external_url,storage_path,name,extension').eq('id', parsed.data).maybeSingle()
  if (!media) throw notFound('الملف غير موجود')
  const { data: book } = await db.from('books').select('id,kind,status,deleted_at').eq('id', media.book_id).maybeSingle()
  if (!book || book.deleted_at) throw notFound('الملف غير موجود')

  const user = await getOptionalUser(event)
  let isAdmin = false
  if (user) {
    const { data } = await (await userClient(event)).rpc('is_admin')
    isAdmin = data === true
  }
  const published = book.status === 'published' || book.status === 'coming_soon'
  if (!published && !isAdmin) throw notFound('الملف غير موجود')

  const open = media.visibility === 'preview' || (book.kind === 'free' && book.status === 'published')
  if (!open && !isAdmin) {
    if (!user) throw unauthorized()
    const { data: ent } = await db.from('entitlements').select('id').eq('user_id', user.id).eq('book_id', book.id).is('revoked_at', null).maybeSingle()
    if (!ent) throw forbidden('يجب شراء الكتاب أولاً')
  }

  await db.rpc('increment_media_download', { p_media: media.id })

  if (media.is_external) {
    let url: URL | null = null
    try { url = new URL(media.external_url ?? '') } catch { /* invalid */ }
    if (!url || url.protocol !== 'https:') throw notFound('رابط الملف غير صالح')
    return sendRedirect(event, url.toString(), 302)
  }
  if (!media.storage_path) throw notFound('الملف غير متاح')
  const ttl = Number(useRuntimeConfig(event).signedUrlTtlSeconds) || 120
  const { data: signed, error } = await db.storage.from('private-products').createSignedUrl(media.storage_path, ttl, {
    download: `${media.name || 'book'}.${media.extension || 'pdf'}`,
  })
  if (error || !signed) throw createError({ statusCode: 502, statusMessage: 'تعذر تجهيز رابط التحميل' })
  return sendRedirect(event, signed.signedUrl, 302)
})
