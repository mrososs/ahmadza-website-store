// View-model types shared by pages, components and server routes (DB row types live in database.types.ts).
export interface BookCardData {
  id: number
  title: string
  slug: string
  kind: 'paid' | 'free'
  status: 'draft' | 'published' | 'coming_soon' | 'archived'
  price_amount: number
  price_currency: string
  cover_path: string | null
}
export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number; pageCount: number }
export interface SessionInfo { id: string; email: string | null; displayName: string; isAdmin: boolean; isAffiliate: boolean }
