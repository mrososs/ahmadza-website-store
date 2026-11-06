// Counts of development-only seed rows (is_demo = true). Real/imported data is never flagged demo.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const db = serviceClient(event)
  const head = { count: 'exact' as const, head: true }
  const [books, articles, pages, makers, categories] = await Promise.all(
    (['books', 'articles', 'pages', 'makers', 'categories'] as const).map((t) => db.from(t).select('id', head).eq('is_demo', true)),
  )
  const n = (r: { count: number | null } | undefined) => r?.count ?? 0
  return { books: n(books), articles: n(articles), pages: n(pages), makers: n(makers), categories: n(categories) }
})
