// Dashboard metrics (ADM-04). Revenue counts LIVE paid orders only; test-mode orders are never reported as revenue.
export default defineEventHandler(async (event) => {
  await adminRead(event)
  const db = serviceClient(event)
  const head = { count: 'exact' as const, head: true }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const since = today.toISOString()

  const [users, usersToday, contacts, contactsToday, books, booksToday, orders, ordersToday, comments, commentsToday,
    articles, articlesToday, requests, requestsToday, revenue, latestOrders, latestBooks] = await Promise.all([
    db.from('profiles').select('id', head).is('deleted_at', null),
    db.from('profiles').select('id', head).is('deleted_at', null).gte('created_at', since),
    db.from('contact_messages').select('id', head),
    db.from('contact_messages').select('id', head).gte('created_at', since),
    db.from('books').select('id', head).is('deleted_at', null),
    db.from('books').select('id', head).is('deleted_at', null).gte('created_at', since),
    db.from('orders').select('id', head).is('deleted_at', null),
    db.from('orders').select('id', head).is('deleted_at', null).gte('created_at', since),
    db.from('comments').select('id', head),
    db.from('comments').select('id', head).gte('created_at', since),
    db.from('articles').select('id', head).is('deleted_at', null),
    db.from('articles').select('id', head).is('deleted_at', null).gte('created_at', since),
    db.from('contributor_requests').select('id', head),
    db.from('contributor_requests').select('id', head).gte('created_at', since),
    db.from('orders').select('total_amount,currency').eq('mode', 'live').eq('status', 'paid').is('deleted_at', null).limit(20000),
    db.from('orders').select('id,order_no,status,mode,total_amount,currency,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(5),
    db.from('books').select('id,title,status,kind,created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(5),
  ])
  const n = (r: { count: number | null }) => r.count ?? 0
  const revenueByCurrency: Record<string, number> = {}
  for (const o of revenue.data ?? []) revenueByCurrency[o.currency] = Math.round(((revenueByCurrency[o.currency] ?? 0) + Number(o.total_amount)) * 100) / 100
  return {
    cards: {
      users: { total: n(users), today: n(usersToday) }, contacts: { total: n(contacts), today: n(contactsToday) },
      books: { total: n(books), today: n(booksToday) }, orders: { total: n(orders), today: n(ordersToday) },
      comments: { total: n(comments), today: n(commentsToday) }, articles: { total: n(articles), today: n(articlesToday) },
      requests: { total: n(requests), today: n(requestsToday) },
    },
    revenueByCurrency,
    latestOrders: latestOrders.data ?? [],
    latestBooks: latestBooks.data ?? [],
  }
})
