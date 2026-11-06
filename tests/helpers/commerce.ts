// Fixtures for commerce tests: every test gets a fresh, isolated user (orders are immutable, so users are never deleted).
import { randomUUID } from 'node:crypto'
import { DEV_PASSWORD, serviceClient } from './supabase'

export async function createTestUser(opts: { affiliate?: boolean; status?: 'active' | 'review' | 'banned' } = {}) {
  const admin = serviceClient()
  const email = `t-${randomUUID().slice(0, 8)}@aawraq.test`
  const { data, error } = await admin.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true, user_metadata: { display_name: 'مستخدم اختبار' } })
  if (error) throw error
  await admin.from('profiles').update({ is_affiliate: !!opts.affiliate, status: opts.status ?? 'active' }).eq('id', data.user.id)
  return { id: data.user.id, email }
}

/** Demo paid books that have a downloadable after_purchase media row. */
export async function demoPaidBooks(n: number) {
  const admin = serviceClient()
  const { data } = await admin.from('books').select('id,price_amount,book_media!inner(id,visibility)')
    .eq('is_demo', true).eq('kind', 'paid').eq('status', 'published').eq('book_media.visibility', 'after_purchase').order('id').limit(n + 4)
  const rows = (data ?? []).slice(0, n)
  if (rows.length < n) throw new Error('seed: run `node scripts/dev/seed-dev.mjs`')
  return rows.map((b) => ({ id: b.id, price: Number(b.price_amount), mediaId: (b.book_media as { id: number }[])[0]!.id }))
}

export async function setAllowTestPayments(value: boolean) {
  const { error } = await serviceClient().from('site_settings').update({ allow_test_payments: value }).eq('id', 1)
  if (error) throw error
}

/** Unique provider transaction id (payments.provider_transaction_id is UNIQUE by design). */
export const tx = () => `T-${randomUUID()}`
