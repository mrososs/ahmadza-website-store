// Sidebar badge counts (legacy showed per-status counters next to each menu item).
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const db = serviceClient(event)
  const head = { count: 'exact' as const, head: true }

  const [books, booksActive, booksInactive, booksSoon, booksTrash,
    uAll, uReview, uActive, uBanned, uTrash,
    cats, makers, arts, pages, contacts, comments, reqPending, wdPending] = await Promise.all([
    db.from('books').select('id', head).is('deleted_at', null),
    db.from('books').select('id', head).is('deleted_at', null).eq('status', 'published'),
    db.from('books').select('id', head).is('deleted_at', null).in('status', ['draft', 'archived']),
    db.from('books').select('id', head).is('deleted_at', null).eq('status', 'coming_soon'),
    db.from('books').select('id', head).not('deleted_at', 'is', null),
    db.from('profiles').select('id', head).is('deleted_at', null),
    db.from('profiles').select('id', head).is('deleted_at', null).eq('status', 'review'),
    db.from('profiles').select('id', head).is('deleted_at', null).eq('status', 'active'),
    db.from('profiles').select('id', head).is('deleted_at', null).eq('status', 'banned'),
    db.from('profiles').select('id', head).not('deleted_at', 'is', null),
    db.from('categories').select('id', head).is('deleted_at', null),
    db.from('makers').select('id', head).is('deleted_at', null),
    db.from('articles').select('id', head).is('deleted_at', null),
    db.from('pages').select('id', head).is('deleted_at', null),
    db.from('contact_messages').select('id', head).eq('is_handled', false),
    db.from('comments').select('id', head).eq('status', 'pending'),
    db.from('contributor_requests').select('id', head).eq('status', 'pending'),
    db.from('withdrawal_requests').select('id', head).eq('status', 'pending'),
  ])
  const n = (r: { count: number | null }) => r.count ?? 0
  return {
    books: { all: n(books), active: n(booksActive), inactive: n(booksInactive), soon: n(booksSoon), trash: n(booksTrash) },
    users: { all: n(uAll), review: n(uReview), active: n(uActive), banned: n(uBanned), trash: n(uTrash) },
    categories: n(cats), makers: n(makers), articles: n(arts), pages: n(pages),
    contacts: n(contacts), comments: n(comments), requests: n(reqPending), withdrawals: n(wdPending),
  }
})
