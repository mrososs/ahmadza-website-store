import { serviceClient } from '../utils/supabase'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Public, SEO-only listing of published content. Uses the service client but selects ONLY published, non-deleted rows.
export default defineEventHandler(async (event) => {
  const base = (useRuntimeConfig(event).public.siteUrl as string).replace(/\/$/, '')
  const db = serviceClient(event)
  const [books, articles, pages, makers] = await Promise.all([
    db.from('books').select('id,slug,updated_at').in('status', ['published', 'coming_soon']).is('deleted_at', null).limit(5000),
    db.from('articles').select('id,updated_at').eq('status', 'published').eq('kind', 'article').is('deleted_at', null).limit(5000),
    db.from('pages').select('slug,updated_at').eq('status', 'published').is('deleted_at', null).limit(500),
    db.from('makers').select('id').eq('is_active', true).is('deleted_at', null).limit(5000),
  ])
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: '/' }, { loc: '/categories' }, { loc: '/authors' }, { loc: '/articles' }, { loc: '/contact' },
    ...(books.data ?? []).map((b) => ({ loc: `/book/${b.id}/${encodeURIComponent(b.slug)}`, lastmod: b.updated_at })),
    ...(articles.data ?? []).map((a) => ({ loc: `/post/${a.id}`, lastmod: a.updated_at })),
    ...(pages.data ?? []).map((p) => ({ loc: `/p/${encodeURIComponent(p.slug)}`, lastmod: p.updated_at })),
    ...(makers.data ?? []).map((m) => ({ loc: `/maker/${m.id}` })),
  ]
  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=900')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(base + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`
})
