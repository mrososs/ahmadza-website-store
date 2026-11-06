import { quoteSchema, type QuoteItem, type QuoteResponse } from '~~/shared/schemas/commerce'

// Prices come from the database ONLY (legacy ORD-03). Anything price-like in the body is ignored (zod strips it).
export default defineEventHandler(async (event): Promise<QuoteResponse> => {
  rateLimit(event, 'cart-quote', 60, 60_000)
  const parsed = quoteSchema.safeParse(await readBody(event))
  if (!parsed.success) throw badRequest('طلب غير صالح')
  const ids = [...new Set(parsed.data.bookIds)]
  const db = serviceClient(event)

  const { data: books, error } = ids.length
    ? await db.from('books').select('id,title,slug,cover_path,price_amount,price_currency,kind,status')
        .in('id', ids).eq('status', 'published').eq('kind', 'paid').is('deleted_at', null).gt('price_amount', 0)
    : { data: [], error: null }
  if (error) throw fromDbError(error)

  // already-owned books are reported (the DB function refuses to sell them again)
  const user = await getOptionalUser(event)
  let owned: number[] = []
  if (user && ids.length) {
    const { data: ent } = await db.from('entitlements').select('book_id').eq('user_id', user.id).in('book_id', ids).is('revoked_at', null)
    owned = (ent ?? []).map((e) => e.book_id)
  }
  const ownedSet = new Set(owned)
  const found = new Set((books ?? []).map((b) => b.id))
  const items: QuoteItem[] = (books ?? []).filter((b) => !ownedSet.has(b.id)).map((b) => ({
    id: b.id, title: b.title, slug: b.slug, cover_path: b.cover_path, unit_price: Number(b.price_amount), currency: b.price_currency,
  }))
  const cents = items.reduce((s, i) => s + Math.round(i.unit_price * 100), 0)
  return {
    items, total: cents / 100, currency: items[0]?.currency ?? 'USD',
    unavailable: ids.filter((i) => !found.has(i)), owned,
  }
})
