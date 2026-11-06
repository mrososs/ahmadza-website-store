import { requireAffiliate, serviceClient } from '../../utils/supabase'

// Books the affiliate can promote, with attributed sales and the per-sale commission at the current percentage.
export default defineEventHandler(async (event) => {
  const user = await requireAffiliate(event)
  const db = serviceClient(event)
  const { data: set } = await db.from('site_settings').select('affiliate_commission_percent,allow_test_payments').eq('id', 1).single()
  const pct = Number(set?.affiliate_commission_percent ?? 0)

  const { data: books } = await db.from('books').select('id,title,slug,price_amount,price_currency')
    .eq('status', 'published').eq('kind', 'paid').is('deleted_at', null).order('id', { ascending: false }).limit(500)

  const { data: sold } = await db.from('order_items')
    .select('book_id, orders!inner(affiliate_id,mode,status)')
    .eq('orders.affiliate_id', user.id).eq('orders.status', 'paid')
  const counts = new Map<number, number>()
  for (const r of (sold ?? []) as unknown as { book_id: number | null; orders: { mode: string } }[]) {
    if (r.book_id == null) continue
    if (r.orders.mode === 'test' && !set?.allow_test_payments) continue
    counts.set(r.book_id, (counts.get(r.book_id) ?? 0) + 1)
  }
  return {
    affiliateId: user.id,
    books: (books ?? []).map((b) => ({
      id: b.id, title: b.title, slug: b.slug, price: Number(b.price_amount), currency: b.price_currency,
      orders: counts.get(b.id) ?? 0, commission: Math.round(Number(b.price_amount) * pct) / 100,
    })),
  }
})
