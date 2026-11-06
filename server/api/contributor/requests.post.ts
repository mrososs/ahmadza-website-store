import { randomUUID } from 'node:crypto'
import { CONTRIBUTOR_LIMITS } from '~~/shared/constants/affiliate'
import { contributorFormSchema } from '~~/shared/schemas/affiliate'
import { badRequest, forbidden, fromDbError } from '../../utils/errors'
import { rateLimit } from '../../utils/rateLimit'
import { requireUser, serviceClient } from '../../utils/supabase'
import { checkFile, MIME, parseMultipart, type SniffedType } from '../../utils/uploads'

// Legacy "request-book": authenticated customers submit a PDF + IBAN + Ministry-of-Information document for review.
// Fixes vs legacy: documents go to the PRIVATE bucket (owner + admin only, signed URLs), types are checked by magic bytes,
// sizes are enforced, only ACTIVE accounts may submit, and the route is rate limited.
const FILES: { field: string; label: string; required: boolean; allowed: SniffedType[]; max: number; column: string; file: string }[] = [
  { field: 'book', label: 'الكتاب', required: true, allowed: ['pdf'], max: CONTRIBUTOR_LIMITS.bookBytes, column: 'book_path', file: 'book' },
  { field: 'cover', label: 'غلاف الكتاب', required: false, allowed: ['png', 'jpg', 'webp'], max: CONTRIBUTOR_LIMITS.otherBytes, column: 'cover_path', file: 'cover' },
  { field: 'iban_file', label: 'صورة الـ IBAN', required: false, allowed: ['pdf', 'png', 'jpg', 'webp'], max: CONTRIBUTOR_LIMITS.otherBytes, column: 'iban_doc_path', file: 'iban' },
  { field: 'ministry_file', label: 'فسح وزارة الاعلام', required: true, allowed: ['pdf', 'png', 'jpg', 'webp'], max: CONTRIBUTOR_LIMITS.otherBytes, column: 'ministry_doc_path', file: 'ministry' },
]

export default defineEventHandler(async (event) => {
  rateLimit(event, 'contributor-request', CONTRIBUTOR_LIMITS.maxRequestsPerHour, 60 * 60_000)
  const user = await requireUser(event)
  const db = serviceClient(event)

  const { data: profile } = await db.from('profiles').select('status').eq('id', user.id).maybeSingle()
  if (!profile || profile.status !== 'active') throw forbidden('الحساب غير مفعّل')

  const { fields, files } = await parseMultipart(event)
  const parsed = contributorFormSchema.safeParse(fields)
  if (!parsed.success) throw badRequest('بيانات غير صالحة', parsed.error.flatten().fieldErrors)
  const f = parsed.data

  // validate every file before anything is written
  const checked = FILES.map((spec) => {
    const part = files[spec.field]
    if (!part) {
      if (spec.required) throw badRequest(`${spec.label}: مطلوب`)
      return null
    }
    return { spec, part, type: checkFile(part, spec.label, spec.allowed, spec.max) }
  }).filter((x): x is NonNullable<typeof x> => x !== null)

  const id = randomUUID()
  const uploaded: string[] = []
  const paths: Record<string, string> = {}
  for (const c of checked) {
    const path = `${user.id}/${id}/${c.spec.file}.${c.type}`
    const { error } = await db.storage.from('private-sensitive').upload(path, c.part.data, { contentType: MIME[c.type], upsert: false })
    if (error) {
      if (uploaded.length) await db.storage.from('private-sensitive').remove(uploaded)
      throw createError({ statusCode: 500, statusMessage: 'تعذر رفع الملفات' })
    }
    uploaded.push(path)
    paths[c.spec.column] = path
  }

  const { error } = await db.from('contributor_requests').insert({
    id, user_id: user.id, title: f.name, maker_name: f.maker, about: f.about, deal: f.deal,
    cost: f.type === 'free' ? 0 : f.cost, whatsapp: f.whatsapp, iban: f.iban, ...paths,
  })
  if (error) {
    await db.storage.from('private-sensitive').remove(uploaded)
    throw fromDbError(error)
  }
  return { ok: true, id }
})
