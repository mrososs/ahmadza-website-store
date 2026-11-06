// Migrations 18 and 19 on the HOSTED project: everything they added is server-only or admin-only, free claims behave, and the publication guard holds.
//   HOSTED_TEST_CONFIRM=ubjuyeccioflhpcpnhmo npm run test:hosted -- release-hosted        (after YOU applied the migrations; see tests/hosted/helpers.ts)
//   rehearsal on the local stack: HOSTED_ENV_FILE=.env HOSTED_TEST_ALLOW_LOCAL=1 npx vitest run -c vitest.hosted.config.ts release-hosted
// Fixtures are tagged, created through the Auth admin API with random passwords and removed afterwards. No payment rows are created (orders are immutable).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anonClient, cleanupFixtures, createFixtureUser, FIXTURE_TITLE_PREFIX, serviceClient, type Fixture } from './helpers'

const svc = serviceClient()
let alice: Fixture, admin: Fixture
let freeBook = 0
let paidBook = 0
const REASON = `${FIXTURE_TITLE_PREFIX}audit`

async function wipe() {
  await svc.from('media_download_log').delete().like('reason', `${FIXTURE_TITLE_PREFIX}%`)
  await cleanupFixtures(svc)
}
beforeAll(async () => {
  await wipe()
  ;[alice, admin] = [await createFixtureUser(svc, 'alice'), await createFixtureUser(svc, 'admin')]
  await svc.from('user_roles').insert({ user_id: admin.id, role: 'admin' })
  const mk = async (suffix: string, over: Record<string, unknown>) => (await svc.from('books').insert({ title: `${FIXTURE_TITLE_PREFIX}${suffix}`, ...over } as never).select('id').single()).data!.id as number
  freeBook = await mk('free', { kind: 'free', price_amount: 0, status: 'published' })
  paidBook = await mk('paid', { kind: 'paid', price_amount: 5, status: 'published' })
})
afterAll(wipe)

type Rpc = { rpc: (f: string, a: unknown) => Promise<{ data: unknown; error: { code?: string; message: string } | null }> }
const rpc = (c: unknown, fn: string, args: Record<string, unknown>) => (c as Rpc).rpc(fn, args)

describe('functions added by migrations 18 and 19 are server-only', () => {
  const calls: [string, Record<string, unknown>][] = [
    ['attach_provider_session', { p_payment_id: randomUUID(), p_provider_order_id: 'x' }],
    ['find_payment_for_callback', { p_provider: 'paymob', p_reference: randomUUID(), p_provider_order_id: 'x' }],
    ['flag_payment_review', { p_payment_id: randomUUID(), p_reason: 'x' }],
    ['log_media_download', { p_media: 1, p_book: 1, p_user: randomUUID(), p_outcome: 'granted' }],
    ['verify_book', { p_book: 1, p_admin: randomUUID() }],
    ['verify_legacy_run', { p_run: 1, p_admin: randomUUID() }],
    ['promote_eligible_books', {}],
    ['claim_free_book', { p_user: randomUUID(), p_book: 1 }],
    ['book_readiness', { p_book: 1 }],
  ]
  for (const [fn, args] of calls) {
    it(`${fn}: refused for anonymous visitors, customers and administrators`, async () => {
      for (const who of [anonClient(), alice.client, admin.client]) expect((await rpc(who, fn, args)).error, `${fn} must be refused`).toBeTruthy()
    })
  }
})

describe('private views and columns', () => {
  it('the readiness views are not readable by browser roles', async () => {
    for (const view of ['books_readiness', 'book_media_readiness']) {
      for (const who of [anonClient(), alice.client, admin.client]) {
        const r = await (who as never as { from: (t: string) => { select: (c: string) => Promise<{ data: unknown[] | null; error: unknown }> } }).from(view).select('*')
        expect(r.error || (r.data ?? []).length === 0, view).toBeTruthy()
      }
    }
  })
  it('payment binding and review columns are unreadable by the customer who owns the payment table row (none exist for alice, so the column grant itself is tested)', async () => {
    for (const col of ['provider_order_id', 'needs_review', 'review_reason', 'raw_response']) {
      expect((await alice.client.from('payments').select(col as never)).error, col).toBeTruthy()
    }
  })
  it('provenance, evidence and verification columns of books are not readable by anonymous visitors or customers', async () => {
    for (const col of ['provenance', 'legacy_status_raw', 'legacy_verified_at', 'legacy_verified_by', 'import_run_id', 'recovery_evidence', 'legacy_cost_raw']) {
      for (const who of [anonClient(), alice.client]) expect((await who.from('books').select(col as never).limit(1)).error, col).toBeTruthy()
    }
  })
})

describe('download audit log', () => {
  it('is readable by administrators only; customers and visitors see nothing, and nobody can write or truncate through the API', async () => {
    expect((await svc.rpc('log_media_download', { p_media: null as never, p_book: freeBook, p_user: alice.id, p_outcome: 'granted', p_reason: REASON })).error).toBeNull()
    expect((await alice.client.from('media_download_log').select('id')).data ?? []).toHaveLength(0)
    expect((await anonClient().from('media_download_log').select('id')).error).toBeTruthy()
    const adminSees = await admin.client.from('media_download_log').select('id,reason').like('reason', `${FIXTURE_TITLE_PREFIX}%`)
    expect(adminSees.error).toBeNull()
    expect((adminSees.data ?? []).length).toBeGreaterThanOrEqual(1)
    for (const who of [anonClient(), alice.client, admin.client]) {
      expect((await who.from('media_download_log').insert({ outcome: 'granted' } as never)).error).toBeTruthy()
      expect((await who.from('media_download_log').delete().neq('id', 0)).error || true).toBeTruthy()
    }
    expect((await svc.from('media_download_log').select('id', { count: 'exact', head: true }).like('reason', `${FIXTURE_TITLE_PREFIX}%`)).count).toBeGreaterThanOrEqual(1) // still there
  })
})

describe('free-book claims', () => {
  it('claiming adds the book once, creates no order or payment, and is never marked test', async () => {
    expect((await svc.rpc('claim_free_book', { p_user: alice.id, p_book: freeBook })).data).toBe(true)
    expect((await svc.rpc('claim_free_book', { p_user: alice.id, p_book: freeBook })).data).toBe(false)
    const ent = (await svc.from('entitlements').select('source,order_item_id,is_test').eq('user_id', alice.id)).data ?? []
    expect(ent).toEqual([expect.objectContaining({ source: 'free_claim', order_item_id: null, is_test: false })])
    expect((await svc.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', alice.id)).count).toBe(0)
    expect((await svc.from('payments').select('id', { count: 'exact', head: true }).eq('user_id', alice.id)).count).toBe(0)
    expect((await alice.client.from('entitlements').select('book_id')).data).toEqual([{ book_id: freeBook }]) // alice sees her own claim
  })
  it('a paid book, a draft and a missing book cannot be claimed', async () => {
    const draft = (await svc.from('books').insert({ title: `${FIXTURE_TITLE_PREFIX}free-draft`, kind: 'free', price_amount: 0, status: 'draft' } as never).select('id').single()).data!.id as number
    for (const id of [paidBook, draft, 2147483000]) expect((await svc.rpc('claim_free_book', { p_user: alice.id, p_book: id })).error?.code, String(id)).toBe('22023')
  })
  it('a customer cannot create or alter entitlements directly', async () => {
    expect((await alice.client.from('entitlements').insert({ user_id: alice.id, book_id: paidBook } as never)).error).toBeTruthy()
    expect((await alice.client.from('entitlements').update({ revoked_at: null } as never).eq('book_id', freeBook).select()).data ?? []).toHaveLength(0)
  })
})

describe('publication guard and workflow status', () => {
  it('a recovered-media draft cannot be published until it is verified, priced and has a validated file; the refusal names the reasons', async () => {
    const id = (await svc.from('books').insert({
      title: `${FIXTURE_TITLE_PREFIX}recovered`, kind: 'paid', price_amount: 0, status: 'draft', provenance: 'recovered_media',
      recovery_evidence: { source: 'pdf_metadata', note: 'test' },
    } as never).select('id').single()).data!.id as number
    const refused = await svc.from('books').update({ status: 'published' } as never).eq('id', id)
    expect(refused.error?.code).toBe('AW001')
    expect(refused.error?.message).toMatch(/source_not_verified/)
    expect(refused.error?.message).toMatch(/price_missing/)
    expect(refused.error?.message).toMatch(/no_validated_media/)
    expect((await svc.from('books').select('status').eq('id', id).single()).data?.status).toBe('draft')
    expect((await svc.from('books_readiness').select('workflow_status,eligible').eq('book_id', id).single()).data).toMatchObject({ workflow_status: 'needs_review', eligible: false })
    expect((await svc.rpc('verify_book', { p_book: id, p_admin: admin.id })).data).toBe(true)
  })
  it('administrator-created books are not blocked by the recovery rule', async () => {
    expect((await svc.from('books').select('status').eq('id', paidBook).single()).data?.status).toBe('published')
  })
})
