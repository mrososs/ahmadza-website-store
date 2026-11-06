import { requireUser, serviceClient } from '../../utils/supabase'

// /user-book data: the caller's contributor submissions plus per-book statistics for books created from approved
// submissions. Statistics = views, attributed purchases and gross sales. NO contributor payout/net-profit figure is
// produced: the legacy system had no contributor settlement and none is invented (docs/legacy-audit/02).
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = serviceClient(event)

  const [{ data: requests }, { data: stats }, { data: books }] = await Promise.all([
    db.from('contributor_requests')
      .select('id,title,deal,cost,currency,status,review_note,created_at,book_id,cover_path')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(200),
    db.rpc('contributor_book_stats', { p_user: user.id }),
    db.from('books').select('id,title,slug,status,cover_path,created_at').eq('owner_id', user.id).is('deleted_at', null),
  ])
  const byBook = new Map((stats as { book_id: number; views: number; purchases: number; gross: number }[] | null ?? []).map((s) => [s.book_id, s]))
  return {
    requests: (requests ?? []).map(({ cover_path, ...r }) => ({ ...r, cost: r.cost == null ? null : Number(r.cost), hasCover: !!cover_path })),
    books: (books ?? []).map((b) => {
      const s = byBook.get(b.id)
      return { ...b, views: s?.views ?? 0, purchases: Number(s?.purchases ?? 0), gross: Number(s?.gross ?? 0) }
    }),
  }
})
