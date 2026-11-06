export default defineEventHandler((event) => {
  const base = (useRuntimeConfig(event).public.siteUrl as string).replace(/\/$/, '')
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /cart\nDisallow: /library\nDisallow: /affiliate\nSitemap: ${base}/sitemap.xml\n`
})
