import { randomUUID } from 'node:crypto'
import { adminDecisionSchema } from '~~/shared/schemas/affiliate'
import { badRequest, fromDbError, notFound } from '../../../../utils/errors'
import { requireAdmin, serviceClient } from '../../../../utils/supabase'
import { checkFile, MIME, parseMultipart } from '../../../../utils/uploads'

// Approve (mark as paid, optional proof attachment) or reject a withdrawal. Accepts JSON or multipart/form-data.
// All ledger effects happen inside decide_withdrawal(): rejection re-credits the held amount (append-only entry).
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound()

  const isMultipart = (getHeader(event, 'content-type') ?? '').startsWith('multipart/form-data')
  let input: unknown
  let proof: { data: Buffer; type: 'pdf' | 'png' | 'jpg' | 'webp' } | null = null
  if (isMultipart) {
    const { fields, files } = await parseMultipart(event)
    input = fields
    if (files.attachment) proof = { data: files.attachment.data, type: checkFile(files.attachment, 'المرفق', ['pdf', 'png', 'jpg', 'webp'], 2 * 1024 * 1024) }
  } else {
    input = await readBody(event)
  }
  const parsed = adminDecisionSchema.safeParse(input)
  if (!parsed.success) throw badRequest('بيانات غير صالحة')

  const db = serviceClient(event)
  let proofPath: string | null = null
  if (proof && parsed.data.approve) {
    proofPath = `withdrawals/${id}/${randomUUID()}.${proof.type}`
    const { error } = await db.storage.from('private-sensitive').upload(proofPath, proof.data, { contentType: MIME[proof.type], upsert: false })
    if (error) throw createError({ statusCode: 500, statusMessage: 'تعذر رفع المرفق' })
  }
  const { error } = await db.rpc('decide_withdrawal', {
    p_request: id, p_admin: admin.id, p_approve: parsed.data.approve, p_note: parsed.data.note ?? undefined, p_proof_path: proofPath ?? undefined,
  })
  if (error) {
    if (proofPath) await db.storage.from('private-sensitive').remove([proofPath])
    throw fromDbError(error)
  }
  return { ok: true }
})
