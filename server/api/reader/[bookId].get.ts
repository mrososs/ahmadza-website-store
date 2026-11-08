import { idSchema } from '~~/shared/schemas'
import { decideReaderAccess } from '~~/shared/utils/readerAccess'
import { createMediaStorage, MediaUnavailableError, type MediaRecord } from '../../services/storage'

// Reader session: the server (never the client) decides whether this visitor may read the whole book, and only then
// hands the browser a short-lived, signed delivery for the PDF.js reader. Storage paths are never returned.
// Not cacheable anywhere: the answer depends on who is asking.
export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'cache-control': 'private, no-store', vary: 'Cookie' })
  rateLimit(event, 'reader', 60, 60_000)
  const parsed = idSchema.safeParse(getRouterParam(event, 'bookId'))
  if (!parsed.success) throw badRequest('معرّف غير صالح')
  const db = serviceClient(event)
  const user = await getOptionalUser(event)
  const audit = async (media: number | null, outcome: string, reason?: string) => {
    await db.rpc('log_media_download', { p_media: media as number, p_book: parsed.data, p_user: (user?.id ?? null) as string, p_outcome: outcome, p_reason: `reader${reason ? `: ${reason}` : ''}` }).then(() => undefined, () => undefined)
  }

  const { data: book } = await db.from('books').select('id,title,kind,status,deleted_at').eq('id', parsed.data).maybeSingle()
  if (!book || book.deleted_at) { await audit(null, 'not_found'); throw notFound('الكتاب غير موجود') }
  let isAdmin = false
  let hasEntitlement = false
  if (user) {
    isAdmin = (await (await userClient(event)).rpc('is_admin')).data === true
    const { data: ent } = await db.from('entitlements').select('id').eq('user_id', user.id).eq('book_id', book.id).is('revoked_at', null).maybeSingle()
    hasEntitlement = !!ent
  }
  // the full text: the book's available PDF (preview artifacts are images and are served by the public book page instead)
  const { data: files } = await db.from('book_media')
    .select('id,book_id,name,extension,storage_provider,storage_path,external_url,migration_status')
    .eq('book_id', book.id).eq('visibility', 'after_purchase').eq('extension', 'pdf').eq('migration_status', 'available').order('id').limit(1)
  const media = (files?.[0] ?? null) as unknown as MediaRecord | null

  const verdict = decideReaderAccess({ status: book.status, kind: book.kind, isAdmin, signedIn: !!user, hasEntitlement, fileAvailable: !!media })
  if (verdict.state === 'not_found') { await audit(null, 'not_found', 'not visible'); throw notFound('الكتاب غير موجود') }
  if (verdict.state === 'login_required') { await audit(null, 'denied_login'); throw createError({ statusCode: 401, statusMessage: 'purchase_required', data: { state: 'purchase_required', bookId: book.id } }) }
  if (verdict.state === 'purchase_required') { await audit(null, 'denied_purchase', 'no active entitlement'); throw createError({ statusCode: 403, statusMessage: 'purchase_required', data: { state: 'purchase_required', bookId: book.id } }) }
  if (verdict.state === 'unavailable' || !media) { await audit(null, 'unavailable', 'no available file'); throw createError({ statusCode: 503, statusMessage: 'الملف قيد التجهيز', data: { state: 'unavailable' } }) }

  const ttl = Number(useRuntimeConfig(event).signedUrlTtlSeconds) || 120
  try {
    const delivery = await createMediaStorage(event).deliver(media, { ttlSeconds: ttl, downloadName: `${book.id}.pdf` })
    await audit(media.id, 'granted', verdict.via ?? undefined)
    return { state: 'granted', via: verdict.via, title: book.title, source: delivery.url, expiresInSeconds: ttl }
  } catch (e) {
    if (!(e instanceof MediaUnavailableError)) throw e
    await audit(media.id, e.reason === 'invalid_source' ? 'invalid_source' : 'unavailable', e.reason)
    throw createError({ statusCode: 503, statusMessage: 'الملف قيد التجهيز', data: { state: 'unavailable' } })
  }
})
