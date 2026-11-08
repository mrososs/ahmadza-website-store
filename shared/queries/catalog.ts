// Typed, read-only catalog queries. They take any Supabase client (browser, SSR or server route) so the same
// code runs under RLS everywhere. Columns are listed explicitly: private columns are not granted to anon/authenticated.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { BookCardData, Paginated } from '../types/app'
import { ARTICLE_PAGE_SIZE, PAGE_SIZE } from '../constants'
import { ilikeTerm } from '../utils/arabic'

type Client = SupabaseClient<Database>

export const BOOK_CARD_COLS = 'id,title,slug,kind,status,price_amount,price_currency,cover_path'

export interface BookQuery {
  page?: number
  pageSize?: number
  search?: string
  categoryId?: number
  makerId?: number
  order?: 'view' | 'newest'
  hideFree?: boolean
  ids?: number[]
}

function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function listBooks(c: Client, q: BookQuery = {}): Promise<Paginated<BookCardData>> {
  const page = Math.max(1, q.page ?? 1)
  const pageSize = q.pageSize ?? PAGE_SIZE
  let sel = BOOK_CARD_COLS
  if (q.categoryId) sel += ',book_categories!inner(category_id)'
  if (q.makerId) sel += ',book_makers!inner(maker_id)'
  let query = c.from('books').select(sel, { count: 'exact' }).in('status', ['published', 'coming_soon'])
  if (q.categoryId) query = query.eq('book_categories.category_id', q.categoryId)
  if (q.makerId) query = query.eq('book_makers.maker_id', q.makerId)
  if (q.ids) query = query.in('id', q.ids.length ? q.ids : [-1])
  if (q.hideFree) query = query.neq('kind', 'free')
  const term = q.search ? ilikeTerm(q.search) : ''
  if (term) query = query.ilike('title_norm', `%${term}%`)
  query = q.order === 'view' ? query.order('view_count', { ascending: false }).order('id', { ascending: false })
                             : query.order('created_at', { ascending: false }).order('id', { ascending: false })
  const { data, count, error } = await query.range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw error
  return paginate((data ?? []) as unknown as BookCardData[], count ?? 0, page, pageSize)
}

export async function getBook(c: Client, id: number) {
  const { data, error } = await c.from('books')
    .select(`${BOOK_CARD_COLS},description_html,pages,view_count,created_at,
      book_categories(categories(id,name)),
      book_makers(role,makers(id,name,kind,image_path)),
      book_tags(tag),
      book_media(id,kind,visibility,name,extension,page_count,sort_order,is_external,migration_status)`)
    .eq('id', id).in('status', ['published', 'coming_soon']).maybeSingle()
  if (error) throw error
  return data
}

export async function relatedBooks(c: Client, bookId: number, limit = 4): Promise<BookCardData[]> {
  const { data } = await c.from('book_relations').select('book_id,related_id').or(`book_id.eq.${bookId},related_id.eq.${bookId}`)
  const ids = (data ?? []).map((r) => (r.book_id === bookId ? r.related_id : r.book_id)).slice(0, limit)
  if (!ids.length) return []
  return (await listBooks(c, { ids, pageSize: limit })).items
}

export async function listCategories(c: Client, page = 1, pageSize = 100) {
  const { data, count, error } = await c.from('categories').select('id,name,slug,image_path', { count: 'exact' })
    .eq('is_active', true).order('id').range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw error
  return paginate(data ?? [], count ?? 0, page, pageSize)
}

export async function listMakers(c: Client, page = 1, pageSize = PAGE_SIZE) {
  const { data, count, error } = await c.from('makers').select('id,name,kind,image_path', { count: 'exact' })
    .eq('is_active', true).order('id').range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw error
  return paginate(data ?? [], count ?? 0, page, pageSize)
}

export async function getMaker(c: Client, id: number) {
  const { data, error } = await c.from('makers').select('id,name,kind,era,bio_html,image_path')
    .eq('id', id).eq('is_active', true).maybeSingle()
  if (error) throw error
  return data
}

export async function listArticles(c: Client, page = 1, pageSize = ARTICLE_PAGE_SIZE) {
  const { data, count, error } = await c.from('articles').select('id,title,excerpt,poster_path,view_count,created_at', { count: 'exact' })
    .eq('status', 'published').eq('kind', 'article')
    .order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw error
  return paginate(data ?? [], count ?? 0, page, pageSize)
}

export async function latestArticles(c: Client, n = 3) {
  const { data } = await c.from('articles').select('id,title,view_count').eq('status', 'published').eq('kind', 'article')
    .order('created_at', { ascending: false }).limit(n)
  return data ?? []
}

export async function getArticle(c: Client, id: number) {
  const { data, error } = await c.from('articles').select('id,title,excerpt,content_html,poster_path,view_count,created_at,date_is_original')
    .eq('id', id).eq('status', 'published').maybeSingle()
  if (!error) return data
  // 42703 = the date_is_original column is not there yet (migration 20261119000100 not applied): show the article WITHOUT a date rather than fail.
  if (error.code !== '42703') throw error
  const old = await c.from('articles').select('id,title,excerpt,content_html,poster_path,view_count,created_at').eq('id', id).eq('status', 'published').maybeSingle()
  if (old.error) throw old.error
  return old.data ? { ...old.data, date_is_original: false } : null
}

// Legacy /post/<id|token> and /article/<token> links -> the new article id (published articles only).
export async function resolveLegacyArticle(c: Client, ref: string): Promise<number | null> {
  const { data, error } = await c.rpc('resolve_legacy_article', { p_ref: ref })
  if (error) throw error
  return typeof data === 'number' ? data : null
}

export async function getPage(c: Client, slug: string) {
  const { data, error } = await c.from('pages').select('id,slug,title,content_html,positions')
    .eq('slug', slug).eq('status', 'published').maybeSingle()
  if (error) throw error
  return data
}

export async function shellData(c: Client) {
  const [cats, pages, articles, settings, totals] = await Promise.all([
    c.from('categories').select('id,name').eq('is_active', true).order('id').limit(30),
    c.from('pages').select('slug,title,positions').eq('status', 'published').order('id'),
    latestArticles(c, 3),
    c.from('site_settings').select('site_name,phone,email,whatsapp,facebook,twitter,instagram,youtube,telegram,linkedin,logo_path,poster_path,poster_mobile_path,show_poster_desktop,show_poster_mobile,show_free_book_button,base_currency').eq('id', 1).maybeSingle(),
    c.rpc('site_totals'),
  ])
  const t = (totals.data as { books: number; articles: number; views: number }[] | null)?.[0]
  return {
    categories: cats.data ?? [],
    pages: pages.data ?? [],
    latestArticles: articles,
    settings: settings.data,
    stats: { books: Number(t?.books ?? 0), articles: Number(t?.articles ?? 0), views: Number(t?.views ?? 0) },
  }
}
