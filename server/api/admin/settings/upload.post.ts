import type { Database } from '~~/shared/types/database.types'
import { randomUUID } from 'node:crypto'
import { readAdminUpload } from '../../../utils/adminUpload'

const FIELDS = { logo: 'logo_path', poster: 'poster_path', poster_mobile: 'poster_mobile_path' } as const

// Branding uploads (logo / poster / mobile poster) -> public-media, images only. Field comes from ?field=.
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const field = String(getQuery(event).field ?? '') as keyof typeof FIELDS
  const col = FIELDS[field]
  if (!col) throw badRequest('حقل غير معروف')
  const up = await readAdminUpload(event, { groups: ['image'], maxBytes: 2 * 1024 * 1024 })
  const db = serviceClient(event)
  const path = `site/${field}-${randomUUID()}.${up.sniffed.ext}`
  const { error: upErr } = await db.storage.from('public-media').upload(path, up.buffer, { contentType: up.sniffed.mime, upsert: false })
  if (upErr) throw badRequest('تعذر رفع الصورة')
  const { data: old } = await db.from('site_settings').select(col).eq('id', 1).single()
  const { error } = await db.from('site_settings').update({ [col]: path, updated_by: admin.id } as Database['public']['Tables']['site_settings']['Update']).eq('id', 1)
  if (error) { await db.storage.from('public-media').remove([path]); dbFail(error) }
  const prev = (old as unknown as Record<string, string | null> | null)?.[col]
  if (prev) await db.storage.from('public-media').remove([prev])
  await adminAudit(event, admin, 'settings_upload', 'site_settings', 1, { field, path })
  return { path }
})
