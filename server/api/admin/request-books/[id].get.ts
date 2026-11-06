import { notFound } from '../../../utils/errors'
import { requireAdmin, serviceClient } from '../../../utils/supabase'

// One submission with sensitive fields (IBAN, WhatsApp). Admin only; documents are fetched through
// GET /api/contributor/requests/:id/document/:kind (owner or admin, 60 s signed URL).
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound()
  const db = serviceClient(event)
  const { data: r } = await db.from('contributor_requests').select('*').eq('id', id).maybeSingle()
  if (!r) throw notFound()
  const [{ data: owner }, { data: authUser }] = await Promise.all([
    db.from('profiles').select('id,display_name').eq('id', r.user_id).maybeSingle(),
    db.auth.admin.getUserById(r.user_id),
  ])
  const { book_path, cover_path, iban_doc_path, ministry_doc_path, ...rest } = r
  return {
    ...rest, cost: r.cost == null ? null : Number(r.cost),
    owner: { id: r.user_id, name: owner?.display_name ?? '', email: authUser?.user?.email ?? null },
    documents: { book: !!book_path, cover: !!cover_path, iban: !!iban_doc_path, ministry: !!ministry_doc_path },
  }
})
