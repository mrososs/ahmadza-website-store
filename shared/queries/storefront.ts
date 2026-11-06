// Slice A queries (public storefront). Same rules as catalog.ts: explicit granted columns, RLS hides drafts/deleted rows.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { Paginated } from '../types/app'
import { ARTICLE_PAGE_SIZE } from '../constants'
import { ilikeTerm } from '../utils/arabic'

type Client = SupabaseClient<Database>

export interface ArticleQuery { page?: number; keyword?: string; order?: 'desc' | 'asc' | 'view' }

export async function searchArticles(c: Client, q: ArticleQuery = {}) {
  const page = Math.max(1, q.page ?? 1)
  let query = c.from('articles').select('id,title,excerpt,poster_path,view_count,created_at', { count: 'exact' })
    .eq('status', 'published').eq('kind', 'article')
  const term = q.keyword ? ilikeTerm(q.keyword) : ''
  if (term) query = query.ilike('title', `%${term}%`)
  query = q.order === 'view' ? query.order('view_count', { ascending: false })
    : query.order('created_at', { ascending: q.order === 'asc' })
  const { data, count, error } = await query.range((page - 1) * ARTICLE_PAGE_SIZE, page * ARTICLE_PAGE_SIZE - 1)
  if (error) throw error
  const total = count ?? 0
  return { items: data ?? [], total, page, pageSize: ARTICLE_PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / ARTICLE_PAGE_SIZE)) } satisfies Paginated<NonNullable<typeof data>[number]>
}

export interface BookCommentRow { id: number; body: string; created_at: string; author_name: string; is_mine: boolean }

/** SECURITY DEFINER rpc: applies the legacy visibility rule (public / buyers / own). Call client-side only (personalised). */
export async function bookComments(c: Client, bookId: number): Promise<BookCommentRow[]> {
  const { data, error } = await c.rpc('book_comments', { p_book: bookId })
  if (error) throw error
  return (data ?? []) as BookCommentRow[]
}

export async function isFavourite(c: Client, kind: 'book' | 'article', id: number): Promise<boolean> {
  const { count } = await c.from('favourites').select('id', { count: 'exact', head: true }).eq(kind === 'book' ? 'book_id' : 'article_id', id)
  return (count ?? 0) > 0
}

export async function setFavourite(c: Client, userId: string, kind: 'book' | 'article', id: number, on: boolean) {
  const col = kind === 'book' ? 'book_id' : 'article_id'
  if (on) {
    const { error } = await c.from('favourites').insert({ user_id: userId, [col]: id } as never)
    if (error && error.code !== '23505') throw error
  } else {
    const { error } = await c.from('favourites').delete().eq('user_id', userId).eq(col, id)
    if (error) throw error
  }
}
