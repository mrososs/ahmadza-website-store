import { randomUUID } from 'node:crypto'
import { notFound } from '../../../../utils/errors'
import { readAdminUpload } from '../../../../utils/adminUpload'

// Cover / photo / poster upload to the PUBLIC bucket. Images only (magic bytes), max 2 MiB (legacy cover limit).
const TARGETS = {
  books: { table: 'books', col: 'cover_path' },
  categories: { table: 'categories', col: 'image_path' },
  makers: { table: 'makers', col: 'image_path' },
  articles: { table: 'articles', col: 'poster_path' },
} as const

export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const entity = event.context.params?.entity as keyof typeof TARGETS
  const target = TARGETS[entity]
  if (!target) throw notFound('كيان غير معروف')
  const id = intParam(event, 'id')
  const db = adminDb(event)
  const { data: row } = await db.from(target.table).select(`id,${target.col}`).eq('id', id).maybeSingle()
  if (!row) throw notFound()

  const up = await readAdminUpload(event, { groups: ['image'], maxBytes: 2 * 1024 * 1024 })
  const path = `${entity}/${id}/${randomUUID()}.${up.sniffed.ext}`
  const { error: upErr } = await db.storage.from('public-media').upload(path, up.buffer, { contentType: up.sniffed.mime, upsert: false })
  if (upErr) throw badRequest('تعذر رفع الصورة')
  const old = (row as unknown as Record<string, string | null>)[target.col]
  const { error } = await db.from(target.table).update({ [target.col]: path }).eq('id', id)
  if (error) { await db.storage.from('public-media').remove([path]); dbFail(error) }
  if (old) await db.storage.from('public-media').remove([old])
  await adminAudit(event, admin, 'image_upload', target.table, id, { path, sha256: up.sha256 })
  return { path }
})
