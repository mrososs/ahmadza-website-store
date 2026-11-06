import type { H3Event } from 'h3'
import type { ZodType } from 'zod'
import { adminArticleSchema, adminCategorySchema, adminMakerSchema, adminPageSchema } from '~~/shared/schemas'
import { ADMIN_PAGE_SIZE, type AdminEntity } from '~~/shared/schemas/admin'
import { slugify } from '~~/shared/utils/arabic'
import { sanitizeRichText } from '../utils/sanitize'
import { adminDb, dbFail } from '../utils/adminRoute'
import { notFound } from '../utils/errors'

// Generic CRUD for the four simple content entities (categories, makers, articles, pages).
// Writes use the service role only after requireAdmin() in the route; deletes are always SOFT (deleted_at).

interface Query { eq: (c: string, v: unknown) => Query; in: (c: string, v: unknown[]) => Query; not: (c: string, op: string, v: unknown) => Query; is: (c: string, v: unknown) => Query }
type Filter = (q: Query) => Query

interface Cfg {
  table: AdminEntity
  listCols: string
  searchCol: string
  schema: ZodType<Record<string, unknown>>
  prepare: (d: Record<string, unknown>) => Record<string, unknown>
  filters: Record<string, Filter>
}

const activeBool: Record<string, Filter> = {
  all: (q) => q.is('deleted_at', null),
  active: (q) => q.is('deleted_at', null).eq('is_active', true),
  inactive: (q) => q.is('deleted_at', null).eq('is_active', false),
  trash: (q) => q.not('deleted_at', 'is', null),
}
const activeStatus: Record<string, Filter> = {
  all: (q) => q.is('deleted_at', null),
  active: (q) => q.is('deleted_at', null).eq('status', 'published'),
  inactive: (q) => q.is('deleted_at', null).in('status', ['draft', 'archived']),
  trash: (q) => q.not('deleted_at', 'is', null),
}

export const ENTITIES: Record<AdminEntity, Cfg> = {
  categories: {
    table: 'categories', listCols: 'id,name,slug,image_path,is_active,is_demo,created_at,updated_at,deleted_at', searchCol: 'name',
    schema: adminCategorySchema as ZodType<Record<string, unknown>>,
    prepare: (d) => ({ name: d.name, slug: slugify(String(d.name)) || 'category', is_active: d.is_active }),
    filters: activeBool,
  },
  makers: {
    table: 'makers', listCols: 'id,name,kind,era,image_path,is_active,is_demo,created_at,updated_at,deleted_at', searchCol: 'name',
    schema: adminMakerSchema as ZodType<Record<string, unknown>>,
    prepare: (d) => ({ name: d.name, kind: d.kind, era: d.era, bio_html: sanitizeRichText(d.bio_html as string | null), is_active: d.is_active }),
    filters: activeBool,
  },
  articles: {
    table: 'articles', listCols: 'id,title,kind,status,view_count,poster_path,is_demo,created_at,updated_at,deleted_at', searchCol: 'title',
    schema: adminArticleSchema as ZodType<Record<string, unknown>>,
    prepare: (d) => ({ kind: d.kind, title: d.title, excerpt: d.excerpt ?? null, content_html: sanitizeRichText(d.content_html as string | null), status: d.status }),
    filters: activeStatus,
  },
  pages: {
    table: 'pages', listCols: 'id,slug,title,positions,status,is_demo,created_at,updated_at,deleted_at', searchCol: 'title',
    schema: adminPageSchema as ZodType<Record<string, unknown>>,
    prepare: (d) => ({ slug: d.slug, title: d.title, content_html: sanitizeRichText(d.content_html as string | null), positions: d.positions, status: d.status }),
    filters: activeStatus,
  },
}

export const escapeLike = (s: string) => s.replace(/[\\%_,()*]/g, ' ').trim()

export async function listEntity(event: H3Event, cfg: Cfg, q: { page: number; q: string; status: string }) {
  const filter = cfg.filters[q.status] ?? cfg.filters.all!
  let query = adminDb(event).from(cfg.table).select(cfg.listCols, { count: 'exact' }) as unknown as Query & {
    ilike: (c: string, p: string) => Query; order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => Promise<{ data: unknown[] | null; count: number | null; error: { code?: string; message?: string } | null }> }
  }
  query = filter(query) as typeof query
  const term = escapeLike(q.q)
  if (term) query = query.ilike(cfg.searchCol, `%${term}%`) as typeof query
  const { data, count, error } = await query.order('id', { ascending: false }).range((q.page - 1) * ADMIN_PAGE_SIZE, q.page * ADMIN_PAGE_SIZE - 1)
  if (error) dbFail(error)
  return { items: data ?? [], total: count ?? 0, page: q.page, pageSize: ADMIN_PAGE_SIZE }
}

export async function getEntity(event: H3Event, cfg: Cfg, id: number) {
  const { data, error } = await adminDb(event).from(cfg.table).select('*').eq('id', id).maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound()
  return data
}

export async function createEntity(event: H3Event, cfg: Cfg, input: Record<string, unknown>) {
  const { data, error } = await adminDb(event).from(cfg.table).insert(cfg.prepare(input)).select('id').single()
  if (error) dbFail(error)
  return data as { id: number }
}

export async function updateEntity(event: H3Event, cfg: Cfg, id: number, input: Record<string, unknown>) {
  const { data, error } = await adminDb(event).from(cfg.table).update(cfg.prepare(input)).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound()
}

export async function setDeleted(event: H3Event, cfg: Cfg, id: number, deleted: boolean) {
  const { data, error } = await adminDb(event).from(cfg.table).update({ deleted_at: deleted ? new Date().toISOString() : null }).eq('id', id).select('id').maybeSingle()
  if (error) dbFail(error)
  if (!data) throw notFound()
}

export function entityCfg(name: string | undefined): Cfg {
  const cfg = ENTITIES[name as AdminEntity]
  if (!cfg) throw notFound('كيان غير معروف')
  return cfg
}
