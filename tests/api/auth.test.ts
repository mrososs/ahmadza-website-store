import { describe, expect, it } from 'vitest'
import { anonClient, DEV_PASSWORD, DEV_USERS, serviceClient, signedInClient } from '../helpers/supabase'

const MAILPIT = 'http://127.0.0.1:54324'

async function findMail(to: string, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json()).catch(() => ({ messages: [] }))
    const m = (res.messages ?? []).find((x: { To: { Address: string }[] }) => x.To?.some((t) => t.Address === to))
    if (m) return m
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

describe('registration', () => {
  it('sign-up sends a confirmation e-mail, creates a profile, and blocks login until confirmed', async () => {
    const email = `new-${Date.now()}@aawraq.test`
    const c = anonClient()
    const { data, error } = await c.auth.signUp({ email, password: 'Another-Pass-2026!', options: { data: { display_name: 'مستخدم جديد', is_admin: true, role: 'admin' } } })
    expect(error).toBeNull()
    expect(data.user?.id).toBeTruthy()

    const mail = await findMail(email)
    expect(mail, 'confirmation mail in Mailpit').toBeTruthy()

    const db = serviceClient()
    const { data: profile } = await db.from('profiles').select('display_name,is_affiliate,status').eq('id', data.user!.id).single()
    expect(profile?.display_name).toBe('مستخدم جديد')
    expect(profile?.is_affiliate).toBe(false)
    // user-supplied metadata must never grant a role
    const { data: roles } = await db.from('user_roles').select('role').eq('user_id', data.user!.id)
    expect(roles).toHaveLength(0)

    const { error: loginErr } = await anonClient().auth.signInWithPassword({ email, password: 'Another-Pass-2026!' })
    expect(loginErr?.code).toBe('email_not_confirmed')
    await db.auth.admin.deleteUser(data.user!.id)
  })

  it('weak passwords are rejected by Supabase Auth (min 8 chars)', async () => {
    const { error } = await anonClient().auth.signUp({ email: `weak-${Date.now()}@aawraq.test`, password: '123' })
    expect(error).toBeTruthy()
  })
})

describe('login', () => {
  it('accepts a seeded identity and rejects a wrong password', async () => {
    const ok = await signedInClient(DEV_USERS.customer)
    expect(ok.accessToken).toBeTruthy()
    const { error } = await anonClient().auth.signInWithPassword({ email: DEV_USERS.customer, password: DEV_PASSWORD + 'x' })
    expect(error?.code).toBe('invalid_credentials')
  })

  it('is_admin() is true only for the admin role (database-managed)', async () => {
    const admin = await signedInClient(DEV_USERS.admin)
    const customer = await signedInClient(DEV_USERS.customer)
    expect((await admin.client.rpc('is_admin')).data).toBe(true)
    expect((await customer.client.rpc('is_admin')).data).toBe(false)
    expect((await anonClient().rpc('is_admin')).data).toBe(false)
  })

  it('a user cannot promote themselves (no write access to user_roles / profiles.is_affiliate)', async () => {
    const { client, userId } = await signedInClient(DEV_USERS.customer)
    const r1 = await client.from('user_roles').insert({ user_id: userId, role: 'admin' })
    expect(r1.error).toBeTruthy()
    const r2 = await client.from('profiles').update({ is_affiliate: true } as never).eq('id', userId)
    expect(r2.error).toBeTruthy()
    expect((await client.rpc('is_admin')).data).toBe(false)
  })
})

describe('password recovery', () => {
  it('sends a recovery mail for an existing account without revealing existence', async () => {
    const email = `rec-${Date.now()}@aawraq.test`
    const db = serviceClient()
    const { data } = await db.auth.admin.createUser({ email, password: DEV_PASSWORD, email_confirm: true })
    const known = await anonClient().auth.resetPasswordForEmail(email)
    const unknown = await anonClient().auth.resetPasswordForEmail(`ghost-${Date.now()}@aawraq.test`)
    expect(known.error).toBeNull()
    expect(unknown.error).toBeNull()
    expect(await findMail(email)).toBeTruthy()
    await db.auth.admin.deleteUser(data.user!.id)
  })
})
