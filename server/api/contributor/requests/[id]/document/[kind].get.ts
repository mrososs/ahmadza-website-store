import { CONTRIBUTOR_DOC_KINDS, DOCUMENT_URL_TTL, type ContributorDocKind } from '~~/shared/constants/affiliate'
import { forbidden, notFound } from '../../../../../utils/errors'
import { callerIsAdmin } from '../../../../../utils/roles'
import { requireUser, serviceClient } from '../../../../../utils/supabase'

// Contributor documents (book PDF, cover, IBAN proof, Ministry clearance). Legacy served these through a
// public-capability URL (RISK in docs/legacy-audit/12); here only the owner or an admin gets a 60-second signed URL.
const COLUMN: Record<ContributorDocKind, 'book_path' | 'cover_path' | 'iban_doc_path' | 'ministry_doc_path'> = {
  book: 'book_path', cover: 'cover_path', iban: 'iban_doc_path', ministry: 'ministry_doc_path',
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const kind = getRouterParam(event, 'kind') as ContributorDocKind
  if (!/^[0-9a-f-]{36}$/i.test(id) || !CONTRIBUTOR_DOC_KINDS.includes(kind)) throw notFound()

  const db = serviceClient(event)
  const { data: r } = await db.from('contributor_requests')
    .select('user_id,book_path,cover_path,iban_doc_path,ministry_doc_path').eq('id', id).maybeSingle()
  if (!r) throw notFound()
  if (r.user_id !== user.id && !(await callerIsAdmin(event))) throw forbidden()
  const path = r[COLUMN[kind]]
  if (!path) throw notFound('لا يوجد مرفق')
  const { data, error } = await db.storage.from('private-sensitive').createSignedUrl(path, DOCUMENT_URL_TTL)
  if (error || !data) throw notFound()
  return sendRedirect(event, data.signedUrl, 302)
})
