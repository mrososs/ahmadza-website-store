// HTTP-level tests of slice D routes against the running dev server (TEST_APP_URL, default http://localhost:3000)
// and the LOCAL Supabase stack. Requires `npm run dev` + `npm run dev:seed`.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiAs, DEV_PASSWORD, DEV_USERS, serviceClient } from '../helpers/supabase'

type Api = Awaited<ReturnType<typeof apiAs>>
const svc = serviceClient()
// the in-memory rate limiter keys on the client IP; a per-run address keeps repeated local runs independent
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
const rand = () => Math.floor(Math.random() * 250)
const fresh = () => ({ 'x-forwarded-for': `10.${rand()}.${rand()}.${rand()}` })
const XFF = { 'x-forwarded-for': ip }

let guest: Api, customer: Api, customer2: Api, affiliate: Api, admin: Api, contributor: Api, banned: Api
let affiliateId = ''
const createdBooks: number[] = []
const createdUsers: string[] = []

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])

function requestForm(over: Record<string, string> = {}, files: Record<string, Buffer | null> = { book: PDF, ministry_file: PDF }) {
  const fd = new FormData()
  const fields: Record<string, string> = {
    name: `[test-d] ${randomUUID().slice(0, 8)}`, type: 'paid', cost: '9.5', iban: 'SA0380000000608010167519',
    whatsapp: '+966500000000', deal: 'share', about: 'وصف تجريبي للكتاب', maker: 'نبذة تجريبية', agree: '1', ...over,
  }
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  for (const [k, buf] of Object.entries(files)) if (buf) fd.append(k, new Blob([new Uint8Array(buf)]), `${k}.bin`)
  return fd
}

beforeAll(async () => {
  ;[guest, customer, customer2, affiliate, admin, contributor, banned] = await Promise.all([
    apiAs(null), apiAs(DEV_USERS.customer), apiAs(DEV_USERS.customer2), apiAs(DEV_USERS.affiliate), apiAs(DEV_USERS.admin),
    apiAs(DEV_USERS.contributor), apiAs(DEV_USERS.banned),
  ])
  affiliateId = (await svc.rpc('find_user_id_by_email', { p_email: DEV_USERS.affiliate })).data as string
})

afterAll(async () => {
  if (createdBooks.length) await svc.from('books').update({ status: 'archived' }).in('id', createdBooks)
  for (const id of createdUsers) await svc.auth.admin.deleteUser(id)
})

describe('authentication / authorisation', () => {
  it('guests get 401 on every private slice-D route', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/affiliate/summary'], ['GET', '/api/affiliate/books'], ['GET', '/api/affiliate/withdrawals'],
      ['POST', '/api/affiliate/withdrawals'], ['PUT', '/api/affiliate/payout-methods'], ['POST', '/api/affiliate/register'],
      ['GET', '/api/contributor/books'], ['POST', '/api/contributor/requests'],
      ['GET', `/api/contributor/requests/${randomUUID()}/document/book`],
      ['GET', '/api/admin/affiliates'], ['GET', '/api/admin/withdrawals'], ['GET', '/api/admin/request-books'],
    ]
    for (const [method, path] of routes) {
      const r = await guest(path, { method, headers: XFF })
      expect(r.status, `${method} ${path}`).toBe(401)
    }
  })

  it('a non-affiliate customer gets 403 on affiliate routes and on admin routes', async () => {
    for (const path of ['/api/affiliate/summary', '/api/affiliate/books', '/api/affiliate/withdrawals']) {
      expect((await customer(path)).status, path).toBe(403)
    }
    expect((await customer('/api/affiliate/withdrawals', { method: 'POST', json: { amount: 150 }, headers: XFF })).status).toBe(403)
    for (const path of ['/api/admin/affiliates', '/api/admin/withdrawals', '/api/admin/request-books']) {
      expect((await customer(path)).status, path).toBe(403)
    }
    expect((await affiliate('/api/admin/affiliates')).status).toBe(403) // affiliate is not an admin either
  })
})

describe('affiliate programme', () => {
  it('serves public program info and the affiliate dashboard numbers', async () => {
    const pub = await guest('/api/affiliate/program')
    expect(pub.status).toBe(200)
    expect(typeof (await pub.json()).percent).toBe('number')
    const res = await affiliate('/api/affiliate/summary')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.balance).toHaveProperty('available')
    expect(body.settings).toHaveProperty('minWithdrawal')
  })

  it('validates withdrawal input and enforces the minimum on the server', async () => {
    for (const amount of [-5, 0, 'abc', null]) {
      const r = await affiliate('/api/affiliate/withdrawals', { method: 'POST', json: { amount }, headers: XFF })
      expect(r.status, String(amount)).toBe(400)
    }
    const low = await affiliate('/api/affiliate/withdrawals', { method: 'POST', json: { amount: 1 }, headers: XFF })
    expect(low.status).toBe(409)
  })

  it('withdrawal flow: request -> admin lists it with payout details -> admin decides -> cannot re-decide', async () => {
    await svc.from('affiliate_ledger').insert({ affiliate_id: affiliateId, entry_type: 'adjustment', amount: 250, currency: 'USD', available_at: new Date(Date.now() - 1000).toISOString(), memo: '[test-d] api fixture', is_test: false })
    const req = await affiliate('/api/affiliate/withdrawals', { method: 'POST', json: { amount: 100 }, headers: XFF })
    expect(req.status).toBe(200)
    const { id } = await req.json()

    const mine = await (await affiliate('/api/affiliate/withdrawals')).json()
    expect(mine.find((w: { id: string }) => w.id === id)).toMatchObject({ status: 'pending', amount: 100 })

    const list = await (await admin('/api/admin/withdrawals?status=pending')).json()
    const row = list.find((w: { id: string }) => w.id === id)
    expect(row.payout.length).toBeGreaterThan(0) // admin needs the payout details to pay
    expect(row).not.toHaveProperty('proof_path')

    expect((await customer(`/api/admin/withdrawals/${id}/decision`, { method: 'POST', json: { approve: true }, headers: XFF })).status).toBe(403)
    expect((await affiliate(`/api/admin/withdrawals/${id}/decision`, { method: 'POST', json: { approve: true }, headers: XFF })).status).toBe(403)

    const fd = new FormData()
    fd.append('approve', 'true'); fd.append('note', 'تم التحويل')
    fd.append('attachment', new Blob([new Uint8Array(PNG)]), 'proof.png')
    expect((await admin(`/api/admin/withdrawals/${id}/decision`, { method: 'POST', body: fd, headers: XFF })).status).toBe(200)
    const again = await admin(`/api/admin/withdrawals/${id}/decision`, { method: 'POST', json: { approve: false }, headers: XFF })
    expect(again.status).toBe(409)

    const after = (await (await affiliate('/api/affiliate/withdrawals')).json()).find((w: { id: string }) => w.id === id)
    expect(after).toMatchObject({ status: 'paid', hasProof: true })

    // proof: owner + admin only, via a signed URL redirect
    const own = await affiliate(`/api/affiliate/withdrawals/${id}/proof`)
    expect(own.status).toBe(302)
    expect((await customer(`/api/affiliate/withdrawals/${id}/proof`)).status).toBe(403)
    expect((await admin(`/api/affiliate/withdrawals/${id}/proof`)).status).toBe(302)
  })

  it('validates payout methods per kind', async () => {
    expect((await affiliate('/api/affiliate/payout-methods', { method: 'PUT', json: { kind: 'paypal', email: 'nope' }, headers: XFF })).status).toBe(400)
    expect((await affiliate('/api/affiliate/payout-methods', { method: 'PUT', json: { kind: 'bank_transfer', iban: '<script>' }, headers: XFF })).status).toBe(400)
    expect((await affiliate('/api/affiliate/payout-methods', { method: 'PUT', json: { kind: 'paypal', email: 'affiliate@example.invalid', is_active: true }, headers: XFF })).status).toBe(200)
  })

  it('self-registration activates only active accounts', async () => {
    expect((await banned('/api/affiliate/register', { method: 'POST', headers: XFF })).status).toBe(403)
    const email = `d-aff-${randomUUID().slice(0, 8)}@aawraq.test`
    const { data } = await svc.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true })
    createdUsers.push(data.user!.id)
    const freshUser = await apiAs(email)
    expect((await freshUser('/api/affiliate/summary')).status).toBe(403)
    expect((await freshUser('/api/affiliate/register', { method: 'POST', headers: XFF })).status).toBe(200)
    expect((await freshUser('/api/affiliate/summary')).status).toBe(200)
  })

  it('admin can list and inspect affiliates; non-admins cannot change status', async () => {
    const list = await (await admin('/api/admin/affiliates')).json()
    expect(list.some((a: { id: string }) => a.id === affiliateId)).toBe(true)
    const detail = await (await admin(`/api/admin/affiliates/${affiliateId}`)).json()
    expect(detail.profile.id).toBe(affiliateId)
    expect((await customer(`/api/admin/affiliates/${affiliateId}`, { method: 'PATCH', json: { status: 'banned' } })).status).toBe(403)
    expect((await admin(`/api/admin/affiliates/${affiliateId}`, { method: 'PATCH', json: { status: 'bogus' } })).status).toBe(400)
  })
})

describe('contributor submissions', () => {
  it('rejects bad input: missing files, wrong real type, oversize, inactive account, unauthenticated', async () => {
    const noFiles = await contributor('/api/contributor/requests', { method: 'POST', body: requestForm({}, {}), headers: fresh() })
    expect(noFiles.status).toBe(400)
    // a text file renamed .pdf is rejected by magic-byte inspection
    const fake = await contributor('/api/contributor/requests', { method: 'POST', body: requestForm({}, { book: Buffer.from('this is not a pdf at all'), ministry_file: PDF }), headers: fresh() })
    expect(fake.status).toBe(400)
    // a PNG is not an acceptable book
    const wrongType = await contributor('/api/contributor/requests', { method: 'POST', body: requestForm({}, { book: PNG, ministry_file: PDF }), headers: fresh() })
    expect(wrongType.status).toBe(400)
    const badField = await contributor('/api/contributor/requests', { method: 'POST', body: requestForm({ cost: '0' }), headers: fresh() })
    expect(badField.status).toBe(400) // paid book needs a price
    expect((await banned('/api/contributor/requests', { method: 'POST', body: requestForm(), headers: fresh() })).status).toBe(403)
    expect((await guest('/api/contributor/requests', { method: 'POST', body: requestForm(), headers: fresh() })).status).toBe(401)
  })

  it('stores documents privately; only the owner and admins can open them (signed URL), others get 403', async () => {
    const res = await contributor('/api/contributor/requests', { method: 'POST', body: requestForm({}, { book: PDF, ministry_file: PDF, iban_file: PNG, cover: PNG }), headers: fresh() })
    expect(res.status).toBe(200)
    const { id } = await res.json()

    const { data: row } = await svc.from('contributor_requests').select('book_path,ministry_doc_path').eq('id', id).single()
    expect(row!.book_path).toMatch(new RegExp(`^[0-9a-f-]{36}/${id}/book\\.pdf$`))
    // the object is NOT reachable through the public object URL
    const pub = await fetch(`${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/storage/v1/object/public/private-sensitive/${row!.ministry_doc_path}`)
    expect(pub.status).not.toBe(200)

    const owner = await contributor(`/api/contributor/requests/${id}/document/ministry`)
    expect(owner.status).toBe(302)
    const signed = owner.headers.get('location')!
    expect(signed).toContain('token=')
    expect((await fetch(signed)).status).toBe(200)
    expect((await admin(`/api/contributor/requests/${id}/document/book`)).status).toBe(302)
    expect((await customer(`/api/contributor/requests/${id}/document/ministry`)).status).toBe(403)
    expect((await customer2(`/api/contributor/requests/${id}/document/iban`)).status).toBe(403)
    expect((await guest(`/api/contributor/requests/${id}/document/book`)).status).toBe(401)
    expect((await contributor(`/api/contributor/requests/${id}/document/nope`)).status).toBe(404)
    expect((await customer('/api/admin/request-books/' + id)).status).toBe(403)

    // admin review -> approve creates ONE draft book + copies the PDF; a second decision conflicts
    const detail = await (await admin(`/api/admin/request-books/${id}`)).json()
    expect(detail.iban).toBeTruthy()
    expect(detail).not.toHaveProperty('book_path')
    const approve = await admin(`/api/admin/request-books/${id}/decision`, { method: 'POST', json: { approve: true, note: 'ok' }, headers: XFF })
    expect(approve.status).toBe(200)
    const out = await approve.json()
    createdBooks.push(out.bookId)
    const { data: book } = await svc.from('books').select('status,owner_id').eq('id', out.bookId).single()
    expect(book!.status).toBe('draft')
    const { count } = await svc.from('book_media').select('id', { count: 'exact', head: true }).eq('book_id', out.bookId)
    expect(count).toBe(1)
    expect((await admin(`/api/admin/request-books/${id}/decision`, { method: 'POST', json: { approve: true }, headers: XFF })).status).toBe(409)
    expect((await customer(`/api/admin/request-books/${id}/decision`, { method: 'POST', json: { approve: false }, headers: XFF })).status).toBe(403)

    const mine = await (await contributor('/api/contributor/books')).json()
    expect(mine.requests.find((r: { id: string }) => r.id === id).status).toBe('approved')
    expect(mine.books.find((b: { id: number }) => b.id === out.bookId)).toMatchObject({ purchases: 0 })
  })

  it('declining requires admin and records the note', async () => {
    const res = await contributor('/api/contributor/requests', { method: 'POST', body: requestForm(), headers: fresh() })
    const { id } = await res.json()
    const decline = await admin(`/api/admin/request-books/${id}/decision`, { method: 'POST', json: { approve: false, note: 'غير مناسب' }, headers: XFF })
    expect(decline.status).toBe(200)
    const { data } = await svc.from('contributor_requests').select('status,review_note').eq('id', id).single()
    expect(data).toMatchObject({ status: 'declined', review_note: 'غير مناسب' })
  })
})
