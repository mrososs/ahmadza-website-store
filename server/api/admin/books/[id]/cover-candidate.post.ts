import { adminCoverDecisionSchema } from '~~/shared/schemas/admin'
import { decideCandidate, withCurrentCover, type CoverCandidate } from '~~/shared/utils/coverEvidence'
import { badRequest, notFound } from '../../../../utils/errors'

// An administrator approves or rejects ONE proposed cover (a first page generated from the book's PDF, or, later, a recovered original). The decision only touches the cover
// record and cover_path: never status, price or publication, so approving a cover can not make a book purchasable. Approving copies the image from the PRIVATE candidate
// bucket to the public one; it refuses to replace a cover that is not itself a generated one (an authentic or hand-uploaded cover is never overwritten from here).
export default defineEventHandler(async (event) => {
  const admin = await adminWrite(event)
  const id = intParam(event, 'id')
  const { candidate, decision } = await parseBody(event, adminCoverDecisionSchema)
  const db = serviceClient(event)

  const { data: book, error } = await db.from('books').select('id,cover_path,recovery_evidence').eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) dbFail(error)
  if (!book) throw notFound('الكتاب غير موجود')
  const evidence = (book.recovery_evidence ?? {}) as Record<string, unknown>
  const current = (evidence.cover as { current?: { provenance?: string } } | undefined)?.current ?? null

  if (decision === 'approve' && book.cover_path && current?.provenance !== 'generated_from_pdf') {
    throw createError({ statusCode: 409, statusMessage: 'للكتاب غلاف معتمد لا يُستبدل من هنا: ارفع غلافاً جديداً من نموذج الكتاب إن أردت تغييره' })
  }
  const settled = decideCandidate(evidence, candidate, decision, admin.id)
  if (!settled.ok) throw badRequest(settled.reason === 'no such candidate' ? 'المرشح غير موجود' : 'تم البت في هذا المرشح مسبقاً')

  if (!settled.attach) { // reject: only the record changes
    const { error: upErr } = await db.from('books').update({ recovery_evidence: settled.evidence as never }).eq('id', id)
    if (upErr) dbFail(upErr)
    await adminAudit(event, admin, 'cover.reject', 'books', id, { candidate })
    return { ok: true, cover_path: book.cover_path }
  }

  const cand: CoverCandidate = settled.attach
  if (cand.bucket !== 'private-sensitive' || !cand.path?.startsWith(`cover-candidates/${id}/`)) throw badRequest('مسار المرشح غير صالح')
  const dest = `books/${id}/${cand.id}.jpg`
  const copied = await db.storage.from('private-sensitive').copy(cand.path, dest, { destinationBucket: 'public-media' })
  if (copied.error && !/exist|duplicate/i.test(copied.error.message)) throw badRequest('تعذر نسخ الصورة')

  const next = withCurrentCover(settled.evidence, {
    provenance: cand.provenance, method: cand.method, confidence: cand.confidence, bucket: 'public-media', path: dest, sha256: cand.sha256, bytes: cand.bytes,
    width: cand.width, height: cand.height, source_pdf_sha256: cand.source_pdf_sha256, applied_at: new Date().toISOString(), review: 'approved_by_admin', approved_by: admin.id,
  })
  const { error: upErr } = await db.from('books').update({ cover_path: dest, recovery_evidence: next as never }).eq('id', id)
  if (upErr) {
    if (!copied.error) await db.storage.from('public-media').remove([dest]) // no orphan image when the record could not be saved
    dbFail(upErr)
  }
  await adminAudit(event, admin, 'cover.approve', 'books', id, { candidate, path: dest })
  return { ok: true, cover_path: dest }
})
