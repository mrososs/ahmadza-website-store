// LOCAL DEVELOPMENT ONLY. Creates test identities + demo PDF media in the LOCAL Supabase stack.
//   node scripts/dev/seed-dev.mjs
// Refuses to run against anything except 127.0.0.1/localhost. The passwords below are throw-away local test
// credentials — they are not, and must never be, production credentials.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const url = env.NUXT_PUBLIC_SUPABASE_URL
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Refusing to seed non-local Supabase: ${url}`)
const admin = createClient(url, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

export const DEV_PASSWORD = 'Local-Dev-Pass-2026!'
const USERS = [
  { email: 'admin@aawraq.test', name: 'مدير تجريبي', role: 'admin' },
  { email: 'customer@aawraq.test', name: 'عميل تجريبي' },
  { email: 'customer2@aawraq.test', name: 'عميل تجريبي ٢' },
  { email: 'affiliate@aawraq.test', name: 'مسوّق تجريبي', affiliate: true },
  { email: 'contributor@aawraq.test', name: 'مساهم تجريبي' },
  { email: 'banned@aawraq.test', name: 'حساب موقوف', status: 'banned' },
]

const MIN_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

async function ensureUser(u) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  let user = list?.users.find((x) => x.email === u.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password: DEV_PASSWORD, email_confirm: true, user_metadata: { display_name: u.name },
    })
    if (error) throw error
    user = data.user
  }
  await admin.from('profiles').update({
    display_name: u.name, is_affiliate: !!u.affiliate, status: u.status ?? 'active',
  }).eq('id', user.id)
  if (u.role) await admin.from('user_roles').upsert({ user_id: user.id, role: u.role }, { onConflict: 'user_id,role' })
  return user
}

const ids = {}
for (const u of USERS) ids[u.email] = (await ensureUser(u)).id
console.log('users ready:', Object.keys(ids).join(', '))

// demo media for the first demo books + every free demo book (clearly mock PDFs, 1 page)
const { data: books } = await admin.from('books').select('id,title,kind').eq('is_demo', true).order('id')
const targets = (books ?? []).filter((b, i) => i < 8 || b.kind === 'free')
for (const b of targets) {
  const { count } = await admin.from('book_media').select('id', { count: 'exact', head: true }).eq('book_id', b.id)
  if (count) continue
  const rows = [{ visibility: 'after_purchase', name: 'ملف الكتاب (تجريبي)' }]
  if (b.id % 2 === 1) rows.push({ visibility: 'preview', name: 'معاينة (تجريبي)' })
  let order = 0
  for (const r of rows) {
    const path = `books/${b.id}/${randomUUID()}.pdf`
    const { error } = await admin.storage.from('private-products').upload(path, MIN_PDF, { contentType: 'application/pdf', upsert: false })
    if (error) throw error
    await admin.from('book_media').insert({
      book_id: b.id, kind: 'file', visibility: r.visibility, name: r.name, extension: 'pdf', page_count: 1,
      sort_order: order++, storage_path: path, mime_type: 'application/pdf', byte_size: MIN_PDF.length,
    })
  }
}
console.log('demo media ready for', targets.length, 'books')

// the affiliate needs a payout method to be able to request withdrawals in tests
await admin.from('payout_methods').upsert(
  { affiliate_id: ids['affiliate@aawraq.test'], kind: 'paypal', details: { email: 'affiliate@example.invalid' } },
  { onConflict: 'affiliate_id,kind' },
)
console.log('done')
