import type { H3Event } from 'h3'
import type { AdminBookInput } from '~~/shared/schemas'
import { ADMIN_PAGE_SIZE } from '~~/shared/schemas/admin'
import { serviceClient } from '../utils/supabase'
import { dbFail } from '../utils/adminRoute'
import { notFound } from '../utils/errors'
import { sanitizeRichText } from '../utils/sanitize'
import { escapeLike } from './adminCrud'

type BookStatus = 'draft' | 'published' | 'coming_soon' | 'archived'

export async function listBooks(event: H3Event, q: { page: number; q: string; status: string }) {
  const db = serviceClient(event)
  let query = db.from('books').select('id,title,cover_path,status,kind,price_amount,price_currency,view_count,is_demo,created_at,deleted_at', { count: 'exact' })
  switch (q.status) {
    case 'active': query = query.is('deleted_at', null).eq('status', 'published'); break
    case 'inactive': query = query.is('deleted_at', null).in('status', ['draft', 'archived']); break
    case 'soon': query = query.is('deleted_at', null).eq('status', 'coming_soon'); break
    case 'trash': query = query.not('deleted_at', 'is', null); break
    default: query = query.is('deleted_at', null)
  }
  const term = escapeLike(q.q)
  if (term) query = query.ilike('title', `%${term}%`)
  const { data, count, error } = await query.order('id', { ascending: false }).range((q.page - 1) * ADMIN_PAGE_SIZE, q.page * ADMIN_PAGE_SIZE - 1)
  if (error) dbFail(error)
  const ids = (data ?? []).map((b) => b.id)
  const orders = new Map<number, number>(), favs = new Map<number, number>()
  if (ids.length) {
    const [oi, fv] = await Promise.all([
      db.from('order_items').select('book_id').in('book_id', ids),
      db.from('favourites').select('book_id').in('book_id', ids),
    ])
    for (const r of oi.data ?? []) if (r.book_id) orders.set(r.book_id, (orders.get(r.book_id) ?? 0) + 1)
    for (const r of fv.data ?? []) if (r.book_id) favs.set(r.book_id, (favs.get(r.book_id) ?? 0) + 1)
  }
  return {
    items: (data ?? []).map((b) => ({ ...b, orders_count: orders.get(b.id) ?? 0, favourites_count: favs.get(b.id) ?? 0 })),
    total: count ?? 0, page: q.page, pageSize: ADMIN_PAGE_SIZE,
  }
}

export async function getBook(event: H3Event, id: number) {
  const db = serviceClient(event)
  const { data: book, error } = await db.from('books').select('*').eq('id', id).maybeSingle()
  if (error) dbFail(error)
  if (!book) throw notFound('الكتاب غير موجود')
  const [cats, makers, tags, rels] = await Promise.all([
    db.from('book_categories').select('category_id').eq('book_id', id),
    db.from('book_makers').select('maker_id,role').eq('book_id', id),
    db.from('book_tags').select('tag').eq('book_id', id),
    db.from('book_relations').select('book_id,related_id').or(`book_id.eq.${id},related_id.eq.${id}`),
  ])
  return {
    ...book,
    category_ids: (cats.data ?? []).map((c) => c.category_id),
    maker_ids: (makers.data ?? []).map((m) => ({ id: m.maker_id, role: m.role })),
    tags: (tags.data ?? []).map((t) => t.tag),
    related_ids: (rels.data ?? []).map((r) => (r.book_id === id ? r.related_id : r.book_id)),
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

export async function updateBook(event: H3Event, id: number, input: AdminBookInput, relatedIds: number[]) {
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
