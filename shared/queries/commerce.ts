// Customer-side reads. Every query runs with the caller's JWT, so RLS limits rows to the caller's own data.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { BookCardData } from '../types/app'

type Client = SupabaseClient<Database>

export interface LibraryEntry { entitlementId: number; isTest: boolean; grantedAt: string; book: BookCardData }

export async function listLibrary(c: Client): Promise<LibraryEntry[]> {
  const { data, error } = await c.from('entitlements')
    .select('id,is_test,granted_at,books(id,title,slug,kind,status,price_amount,price_currency,cover_path)')
    .is('revoked_at', null).order('granted_at', { ascending: false })
  if (error) throw error
  return (data ?? []).flatMap((e) => {
    const b = Array.isArray(e.books) ? e.books[0] : e.books
    return b ? [{ entitlementId: e.id, isTest: e.is_test, grantedAt: e.granted_at, book: b as unknown as BookCardData }] : []
  })
}

export async function listFavourites(c: Client) {
  const { data, error } = await c.from('favourites')
    .select('id,book_id,article_id,created_at,books(id,title,slug,kind,status,price_amount,price_currency,cover_path),articles(id,title,excerpt,poster_path,view_count,created_at)')
    .order('created_at', { ascending: false })
  if (error) throw error
  const one = <T>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v)
  return {
    books: (data ?? []).flatMap((f) => { const b = one(f.books); return b ? [{ favouriteId: f.id, book: b as unknown as BookCardData }] : [] }),
    articles: (data ?? []).flatMap((f) => { const a = one(f.articles); return a ? [{ favouriteId: f.id, article: a }] : [] }),
  }
}

export async function removeFavourite(c: Client, favouriteId: number) {
  const { error } = await c.from('favourites').delete().eq('id', favouriteId)
  if (error) throw error
}

export async function listOrders(c: Client) {
  const { data, error } = await c.from('orders')
    .select('id,order_no,status,mode,total_amount,currency,created_at,order_items(count)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((o) => ({
    id: o.id, orderNo: o.order_no, status: o.status, mode: o.mode, total: Number(o.total_amount), currency: o.currency, createdAt: o.created_at,
    itemCount: (o.order_items as unknown as { count: number }[])?.[0]?.count ?? 0,
  }))
}

export async function getOrderByNo(c: Client, orderNo: number) {
  const { data, error } = await c.from('orders')
    .select('id,order_no,status,mode,total_amount,currency,created_at,user_id,order_items(id,book_id,title_snapshot,unit_price)')
    .eq('order_no', orderNo).maybeSingle()
  if (error) throw error
  return data
}

export const invoiceNumber = (n: number) => `#${String(n).padStart(7, '0')}`
