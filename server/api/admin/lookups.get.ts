// Small lists used by the admin forms (category / maker / book pickers).
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const db = serviceClient(event)
  const [categories, makers, books] = await Promise.all([
    db.from('categories').select('id,name').is('deleted_at', null).order('name').limit(500),
    db.from('makers').select('id,name,kind').is('deleted_at', null).order('name').limit(1000),
    db.from('books').select('id,title').is('deleted_at', null).order('id', { ascending: false }).limit(500),
  ])
  return { categories: categories.data ?? [], makers: makers.data ?? [], books: books.data ?? [] }
})
