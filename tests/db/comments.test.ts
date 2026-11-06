import { afterAll, describe, expect, it } from 'vitest'
import { anonClient, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'

const db = serviceClient()
const created: number[] = []
const body = () => `تعليق اختبار ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

afterAll(async () => { if (created.length) await db.from('comments').delete().in('id', created) })

describe('comments RLS', () => {
  it('guests cannot insert', async () => {
    const { error } = await anonClient().from('comments').insert({ user_id: '00000000-0000-0000-0000-000000000000', book_id: 1, body: body() })
    expect(error).toBeTruthy()
  })

  it('banned users cannot insert', async () => {
    const { client, userId } = await signedInClient(DEV_USERS.banned)
    const { error } = await client.from('comments').insert({ user_id: userId, book_id: 1, body: body() })
    expect(error).toBeTruthy()
  })

  it('a user cannot comment as someone else or force an approved status', async () => {
    const { client, userId } = await signedInClient(DEV_USERS.customer)
    const other = (await signedInClient(DEV_USERS.customer2)).userId
    expect((await client.from('comments').insert({ user_id: other, book_id: 1, body: body() })).error).toBeTruthy()
    expect((await client.from('comments').insert({ user_id: userId, book_id: 1, body: body(), status: 'approved' } as never)).error).toBeTruthy()
  })

  it('a pending comment is visible to its author only; approved + public becomes visible to everyone', async () => {
    const { client, userId } = await signedInClient(DEV_USERS.customer)
    const text = body()
    const ins = await client.from('comments').insert({ user_id: userId, book_id: 3, body: text })
    expect(ins.error).toBeNull()
    const { data: row } = await db.from('comments').select('id,status,visible_to_public').eq('body', text).single()
    created.push(row!.id)
    expect(row!.status).toBe('pending')

    const anon = anonClient()
    expect((await anon.rpc('book_comments', { p_book: 3 })).data?.some((c) => c.body === text)).toBe(false)
    expect((await anon.from('comments').select('id').eq('id', row!.id)).data).toHaveLength(0)
    const mine = (await client.rpc('book_comments', { p_book: 3 })).data
    expect(mine?.find((c) => c.body === text)?.is_mine).toBe(true)
    const other = await signedInClient(DEV_USERS.customer2)
    expect((await other.client.rpc('book_comments', { p_book: 3 })).data?.some((c) => c.body === text)).toBe(false)

    // approved but not public: only buyers / author see it
    await db.from('comments').update({ status: 'approved' }).eq('id', row!.id)
    expect((await anon.rpc('book_comments', { p_book: 3 })).data?.some((c) => c.body === text)).toBe(false)
    await db.from('comments').update({ visible_to_public: true }).eq('id', row!.id)
    expect((await anon.rpc('book_comments', { p_book: 3 })).data?.some((c) => c.body === text)).toBe(true)
  })

  it('comments on draft books are never listed', async () => {
    const { data: draft } = await db.from('books').select('id').eq('status', 'draft').eq('is_demo', true).limit(1)
    if (!draft?.[0]) return
    expect((await anonClient().rpc('book_comments', { p_book: draft[0].id })).data ?? []).toHaveLength(0)
  })
})
