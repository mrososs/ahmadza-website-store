import type { H3Event } from 'h3'
import type { AdminBookInput } from '~~/shared/schemas'
import { ADMIN_PAGE_SIZE } from '~~/shared/schemas/admin'
import { serviceClient } from '../utils/supabase'
import { dbFail } from '../utils/adminRoute'
import { notFound } from '../utils/errors'
import { sanitizeRichText } from '../utils/sanitize'
import { escapeLike } from './adminCrud'
import { assessReader, type ReadinessMedia } from '~~/shared/utils/readerReadiness'

type BookStatus = 'draft' | 'published' | 'coming_soon' | 'archived'

type RecoveryFilter = 'all' | 'recovered' | 'not_ready' | 'ready' | 'missing_media'
const BOOK_LIST_COLUMNS = 'id,title,cover_path,status,kind,price_amount,price_currency,view_count,is_demo,created_at,deleted_at,provenance,cover_provenance:recovery_evidence->cover->current->>provenance,cover_pending:recovery_evidence->cover->>has_pending'

/** Ids of the books that have an author / a verified file, so "has no author" and "has no verified file" can be a NOT IN. */
async function pagedBookIds(read: (from: number) => PromiseLike<{ data: Array<{ book_id: number | null }> | null; error: { code?: string; message?: string } | null }>): Promise<number[]> {
  const ids = new Set<number>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from)
    if (error) dbFail(error)
    for (const r of data ?? []) if (r.book_id != null) ids.add(r.book_id)
    if ((data ?? []).length < 1000) return [...ids]
  }
}
const booksWithAuthor = (db: ReturnType<typeof serviceClient>) => pagedBookIds((from) => db.from('book_makers').select('book_id').eq('role', 'author').order('book_id').range(from, from + 999))
const booksWithFile = (db: ReturnType<typeof serviceClient>) => pagedBookIds((from) => db.from('book_media').select('book_id').eq('migration_status', 'available').order('id').range(from, from + 999))

export async function listBooks(event: H3Event, q: { page: number; q: string; status: string; recovery?: RecoveryFilter; workflow?: string; cover?: string; gap?: string }) {
  const db = serviceClient(event)
  const range: [number, number] = [(q.page - 1) * ADMIN_PAGE_SIZE, q.page * ADMIN_PAGE_SIZE - 1]
  const term = escapeLike(q.q)
  const recovery = q.recovery ?? 'all'
  const workflow = q.workflow ?? 'all'
  const cover = q.cover ?? 'all'
  const gap = q.gap ?? 'all'
  let rows: Array<Record<string, unknown> & { id: number }> = []
  let total = 0
  if (cover !== 'all' || gap !== 'all') {
    // cover / gap filters read the books table directly (the cover record lives in recovery_evidence); workflow and recovery filters are intersected by id
    let query = db.from('books').select(BOOK_LIST_COLUMNS, { count: 'exact' }).is('deleted_at', null)
    switch (q.status) {
      case 'active': query = query.eq('status', 'published'); break
      case 'inactive': query = query.in('status', ['draft', 'archived']); break
      case 'soon': query = query.eq('status', 'coming_soon'); break
      case 'trash': query = query.eq('id', -1); break
      default:
    }
    if (cover === 'none') query = query.is('cover_path', null)
    if (cover === 'generated') query = query.eq('recovery_evidence->cover->current->>provenance', 'generated_from_pdf')
    if (cover === 'original') query = query.eq('recovery_evidence->cover->current->>provenance', 'original_cover')
    if (cover === 'candidate') query = query.eq('recovery_evidence->cover->>has_pending', 'true')
    if (gap === 'price') query = query.eq('price_amount', 0).neq('kind', 'free')
    if (gap === 'author') { const ids = await booksWithAuthor(db); if (ids.length) query = query.not('id', 'in', `(${ids.join(',')})`) }
    if (gap === 'pdf') { const ids = await booksWithFile(db); if (ids.length) query = query.not('id', 'in', `(${ids.join(',')})`) }
    if (recovery !== 'all' || workflow !== 'all') {
      let rq = db.from('books_readiness').select('book_id').limit(5000)
      if (recovery !== 'all') rq = rq.in('provenance', ['legacy', 'recovered_media'])
      if (workflow !== 'all') rq = rq.eq('workflow_status', workflow)
      if (recovery === 'not_ready') rq = rq.eq('eligible', false)
      if (recovery === 'ready') rq = rq.eq('eligible', true)
      if (recovery === 'missing_media') rq = rq.or('media_missing.gt.0,media_validated.eq.0')
      const { data: rids, error: rerr } = await rq
      if (rerr) dbFail(rerr)
      const idList = (rids ?? []).map((r) => r.book_id).filter((v): v is number => v != null)
      query = idList.length ? query.in('id', idList) : query.eq('id', -1)
    }
    if (term) query = query.ilike('title', `%${term}%`)
    const { data, count, error } = await query.order('id', { ascending: false }).range(...range)
    if (error) dbFail(error)
    rows = (data ?? []) as unknown as typeof rows
    total = count ?? 0
  } else if (recovery === 'all' && workflow === 'all') {
    let query = db.from('books').select(BOOK_LIST_COLUMNS, { count: 'exact' })
    switch (q.status) {
      case 'active': query = query.is('deleted_at', null).eq('status', 'published'); break
      case 'inactive': query = query.is('deleted_at', null).in('status', ['draft', 'archived']); break
      case 'soon': query = query.is('deleted_at', null).eq('status', 'coming_soon'); break
      case 'trash': query = query.not('deleted_at', 'is', null); break
      default: query = query.is('deleted_at', null)
    }
    if (term) query = query.ilike('title', `%${term}%`)
    const { data, count, error } = await query.order('id', { ascending: false }).range(...range)
    if (error) dbFail(error)
    rows = (data ?? []) as typeof rows
    total = count ?? 0
  } else {
    // recovery filters read the readiness view (it only lists non-deleted books), then load the display columns for that page
    let query = db.from('books_readiness').select('book_id', { count: 'exact' })
    if (recovery !== 'all') query = query.in('provenance', ['legacy', 'recovered_media'])
    if (workflow !== 'all') query = query.eq('workflow_status', workflow)
    switch (q.status) {
      case 'active': query = query.eq('status', 'published'); break
      case 'inactive': query = query.in('status', ['draft', 'archived']); break
      case 'soon': query = query.eq('status', 'coming_soon'); break
      case 'trash': query = query.eq('book_id', -1); break
      default:
    }
    if (recovery === 'not_ready') query = query.eq('eligible', false)
    if (recovery === 'ready') query = query.eq('eligible', true)
    if (recovery === 'missing_media') query = query.or('media_missing.gt.0,media_validated.eq.0')
    if (term) query = query.ilike('title', `%${term}%`)
    const { data: ids, count, error } = await query.order('book_id', { ascending: false }).range(...range)
    if (error) dbFail(error)
    total = count ?? 0
    const pageIds = (ids ?? []).map((r) => r.book_id).filter((v): v is number => v != null)
    if (pageIds.length) {
      const res = await db.from('books').select(BOOK_LIST_COLUMNS).in('id', pageIds).order('id', { ascending: false })
      if (res.error) dbFail(res.error)
      rows = (res.data ?? []) as typeof rows
    }
  }
  const ids = rows.map((b) => b.id)
  const orders = new Map<number, number>(), favs = new Map<number, number>(), ready = new Map<number, { eligible: boolean; reasons: string[]; media_total: number; media_validated: number; media_missing: number; workflow_status: string | null }>()
  if (ids.length) {
    const [oi, fv, rd] = await Promise.all([
      db.from('order_items').select('book_id').in('book_id', ids),
      db.from('favourites').select('book_id').in('book_id', ids),
      db.from('books_readiness').select('book_id,eligible,reasons,media_total,media_validated,media_missing,workflow_status').in('book_id', ids),
    ])
    for (const r of oi.data ?? []) if (r.book_id) orders.set(r.book_id, (orders.get(r.book_id) ?? 0) + 1)
    for (const r of fv.data ?? []) if (r.book_id) favs.set(r.book_id, (favs.get(r.book_id) ?? 0) + 1)
    for (const r of rd.data ?? []) if (r.book_id != null) ready.set(r.book_id, { eligible: !!r.eligible, reasons: r.reasons ?? [], media_total: Number(r.media_total ?? 0), media_validated: Number(r.media_validated ?? 0), media_missing: Number(r.media_missing ?? 0), workflow_status: r.workflow_status })
  }
  return {
    items: rows.map((b) => ({ ...b, orders_count: orders.get(b.id) ?? 0, favourites_count: favs.get(b.id) ?? 0, readiness: ready.get(b.id) ?? null })),
    total, page: q.page, pageSize: ADMIN_PAGE_SIZE,
  }
}

export async function getBook(event: H3Event, id: number) {
  const db = serviceClient(event)
  const { data: book, error } = await db.from('books').select('*').eq('id', id).maybeSingle()
  if (error) dbFail(error)
  if (!book) throw notFound('الكتاب غير موجود')
  const [cats, makers, tags, rels, readiness, media] = await Promise.all([
    db.from('book_categories').select('category_id').eq('book_id', id),
    db.from('book_makers').select('maker_id,role').eq('book_id', id),
    db.from('book_tags').select('tag').eq('book_id', id),
    db.from('book_relations').select('book_id,related_id').or(`book_id.eq.${id},related_id.eq.${id}`),
    db.rpc('book_readiness', { p_book: id }),
    db.from('book_media_readiness').select('media_id,name,kind,visibility,migration_status,storage_provider,is_external,legacy_book_media_id,has_hash,checksum_verified_at,validated').eq('book_id', id).order('media_id'),
  ])
  const r = readiness.data?.[0]
  // Cover candidates wait in a PRIVATE bucket: the administrator sees them through short-lived signed links, never a public address.
  const candidates = ((book.recovery_evidence as { cover?: { candidates?: Array<{ id: string; bucket?: string; path?: string }> } } | null)?.cover?.candidates ?? [])
  const cover_candidate_previews: Record<string, string> = {}
  for (const c of candidates) {
    if (c.bucket !== 'private-sensitive' || !c.path?.startsWith(`cover-candidates/${id}/`)) continue
    const signed = await db.storage.from('private-sensitive').createSignedUrl(c.path, 600)
    if (signed.data?.signedUrl) cover_candidate_previews[c.id] = signed.data.signedUrl
  }
  // Other books with exactly the same title: possibly another edition, possibly a repeat. Shown as a warning; nothing is merged.
  const dup = await db.from('books').select('id').eq('title', book.title).neq('id', id).is('deleted_at', null).order('id').limit(20)
  return {
    ...book,
    cover_candidate_previews,
    duplicate_title_ids: (dup.data ?? []).map((d) => d.id),
    category_ids: (cats.data ?? []).map((c) => c.category_id),
    maker_ids: (makers.data ?? []).map((m) => ({ id: m.maker_id, role: m.role })),
    tags: (tags.data ?? []).map((t) => t.tag),
    related_ids: (rels.data ?? []).map((x) => (x.book_id === id ? x.related_id : x.book_id)),
    readiness: { eligible: r?.eligible ?? false, reasons: r?.reasons ?? [] },
    media_readiness: media.data ?? [],
  }
}

/** Replace the relation sets of a book (categories, makers, tags, related). Runs after the row itself is saved. */
async function syncRelations(event: H3Event, id: number, input: AdminBookInput, relatedIds: number[]) {
  const db = serviceClient(event)
  const steps = [
    db.from('book_categories').delete().eq('book_id', id),
    db.from('book_makers').delete().eq('book_id', id),
    db.from('book_tags').delete().eq('book_id', id),
    db.from('book_relations').delete().or(`book_id.eq.${id},related_id.eq.${id}`),
  ]
  for (const r of await Promise.all(steps)) if (r.error) dbFail(r.error)
  const inserts = []
  if (input.category_ids.length) inserts.push(db.from('book_categories').insert([...new Set(input.category_ids)].map((category_id) => ({ book_id: id, category_id }))))
  const makers = [...new Map(input.maker_ids.map((m) => [`${m.id}:${m.role}`, m])).values()]
  if (makers.length) inserts.push(db.from('book_makers').insert(makers.map((m) => ({ book_id: id, maker_id: m.id, role: m.role }))))
  const tags = [...new Set(input.tags)]
  if (tags.length) inserts.push(db.from('book_tags').insert(tags.map((tag) => ({ book_id: id, tag }))))
  const rel = [...new Set(relatedIds)].filter((r) => r !== id)
  if (rel.length) inserts.push(db.from('book_relations').insert(rel.map((r) => ({ book_id: Math.min(id, r), related_id: Math.max(id, r) }))))
  for (const r of await Promise.all(inserts)) if (r.error) dbFail(r.error)
}

function rowOf(input: AdminBookInput) {
  return {
    title: input.title, description_html: sanitizeRichText(input.description_html), kind: input.kind, status: input.status as BookStatus,
    price_amount: input.kind === 'free' ? 0 : input.price_amount, price_currency: 'USD', pages: input.pages,
  }
}

export async function createBook(event: H3Event, input: AdminBookInput, relatedIds: number[]) {
  const db = serviceClient(event)
  const { data, error } = await db.from('books').insert(rowOf(input)).select('id').single()
  if (error) dbFail(error)
  await syncRelations(event, data.id, input, relatedIds)
  return data
}

// Reader / delivery assessment for one book (no storage paths). Used by the admin panel and by the publish guard below.
export async function readerAssessment(event: H3Event, id: number) {
  const db = serviceClient(event)
  const { data: book, error } = await db.from('books').select('id,kind,status,price_amount').eq('id', id).is('deleted_at', null).maybeSingle()
  if (error) dbFail(error)
  if (!book) throw notFound('الكتاب غير موجود')
  const { data: media, error: e2 } = await db.from('book_media').select('id,extension,visibility,migration_status,page_count,sha256').eq('book_id', id)
  if (e2) dbFail(e2)
  return { book, assessment: assessReader(book, (media ?? []) as ReadinessMedia[]) }
}

// A paid book must never be published while a public PDF is the book itself.
async function assertNoPublicFullPdf(event: H3Event, id: number, status: string) {
  if (status !== 'published') return
  const { assessment } = await readerAssessment(event, id)
  if (assessment.publicFullPdf) throw createError({ statusCode: 409, statusMessage: 'لا يمكن نشر كتاب مدفوع بينما ملف عام مطابق للكتاب الكامل: احذف الملف العام أولاً' })
}

export async function updateBook(event: H3Event, id: number, input: AdminBookInput, relatedIds: number[]) {
  await assertNoPublicFullPdf(event, id, input.status)
  const db = serviceClient(event)
  // slug '' makes the DB trigger regenerate it from the (possibly changed) title
  const { data, error } = await db.from('books').update({ ...rowOf(input), slug: '' }).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound('الكتاب غير موجود')
  await syncRelations(event, id, input, relatedIds)
}

export async function setBookDeleted(event: H3Event, id: number, deleted: boolean) {
  const { data, error } = await serviceClient(event).from('books').update({ deleted_at: deleted ? new Date().toISOString() : null }).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound('الكتاب غير موجود')
}

/** Clone = metadata + relations as a DRAFT. Media files are deliberately NOT copied (legacy clone caused file-name collisions). */
export async function cloneBook(event: H3Event, id: number) {
  const src = await getBook(event, id)
  const db = serviceClient(event)
  const { data, error } = await db.from('books').insert({
    title: `نسخة من ${src.title}`.slice(0, 250), description_html: src.description_html, kind: src.kind, status: 'draft',
    price_amount: src.price_amount, price_currency: src.price_currency, pages: src.pages, cover_path: src.cover_path,
  }).select('id').single()
  if (error) dbFail(error)
  await syncRelations(event, data.id, {
    title: src.title, kind: src.kind, status: 'draft', price_amount: Number(src.price_amount), pages: src.pages,
    category_ids: src.category_ids, maker_ids: src.maker_ids, tags: src.tags,
  }, [])
  return data
}
