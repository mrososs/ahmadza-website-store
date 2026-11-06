import { idSchema } from '~~/shared/schemas'
import { createMediaStorage, MediaUnavailableError, type MediaRecord } from '../../../services/storage'

type Outcome = 'granted' | 'denied_login' | 'denied_purchase' | 'unavailable' | 'not_found' | 'invalid_source'

// Secure delivery of book files (legacy AUTH-19 / ORD-17, rebuilt):
//  - preview media of a published book: everyone
//  - after_purchase media: free book (open to guests), OR an active entitlement, OR an admin
//  - paid files live in the PRIVATE bucket and are only ever handed out as short-lived signed URLs (302); storage paths are never returned.
export default defineEventHandler(async (event) => {
  rateLimit(event, 'download', 60, 60_000)
  const parsed = idSchema.safeParse(getRouterParam(event, 'mediaId'))
  if (!parsed.success) throw badRequest('معرّف غير صالح')
  const db = serviceClient(event)
  // Audit trail: who asked for which file and what happened. No IP address, no path. A logging failure never blocks (or grants) a download.
  let who: string | null = null
  const audit = async (media: number | null, book: number | null, outcome: Outcome, reason?: string) => {
    await db.rpc('log_media_download', { p_media: media as number, p_book: book as number, p_user: who as string, p_outcome: outcome, p_reason: reason as string }).then(() => undefined, () => undefined)
  }

  const { data: media } = await db.from('book_media')
    .select('id,book_id,visibility,name,extension,storage_provider,storage_path,external_url,migration_status').eq('id', parsed.data).maybeSingle()
  if (!media) { await audit(null, null, 'not_found'); throw notFound('الملف غير موجود') }
  const { data: book } = await db.from('books').select('id,kind,status,deleted_at').eq('id', media.book_id).maybeSingle()
  if (!book || book.deleted_at) { await audit(media.id, media.book_id, 'not_found', 'book missing or deleted'); throw notFound('الملف غير موجود') }

  const user = await getOptionalUser(event)
  who = user?.id ?? null
  let isAdmin = false
  if (user) {
    const { data } = await (await userClient(event)).rpc('is_admin')
    isAdmin = data === true
  }
  const published = book.status === 'published' || book.status === 'coming_soon'
  if (!published && !isAdmin) { await audit(media.id, book.id, 'not_found', 'book not published'); throw notFound('الملف غير موجود') }

  const open = media.visibility === 'preview' || (book.kind === 'free' && book.status === 'published')
  if (!open && !isAdmin) {
    if (!user) { await audit(media.id, book.id, 'denied_login'); throw unauthorized() }
    const { data: ent } = await db.from('entitlements').select('id').eq('user_id', user.id).eq('book_id', book.id).is('revoked_at', null).maybeSingle()
    if (!ent) { await audit(media.id, book.id, 'denied_purchase', 'no active entitlement'); throw forbidden('يجب شراء الكتاب أولاً') }
  }

  // Authorisation is decided above; the storage adapter only turns an AUTHORISED request into a short-lived delivery.
  const ttl = Number(useRuntimeConfig(event).signedUrlTtlSeconds) || 120
  const record = media as unknown as MediaRecord
  try {
    const delivery = await createMediaStorage(event).deliver(record, { ttlSeconds: ttl, downloadName: `${media.name || 'book'}.${media.extension || 'pdf'}` })
    await db.rpc('increment_media_download', { p_media: media.id })
    await audit(media.id, book.id, 'granted')
    return sendRedirect(event, delivery.url, 302)
  } catch (e) {
    if (!(e instanceof MediaUnavailableError)) throw e
    // fail safely and explicitly: never a fake URL, never a public path, never a silent success
    if (e.reason === 'invalid_source') { await audit(media.id, book.id, 'invalid_source'); throw notFound('رابط الملف غير صالح') }
    await audit(media.id, book.id, 'unavailable', e.reason)
    throw createError({
      statusCode: 503,
      statusMessage: 'الملف قيد التجهيز وسيكون متاحاً قريباً',
      data: { reason: e.reason },
    })
  }
})
