// Hosted-project test harness. Deliberately separate from tests/helpers/supabase.ts (which refuses every non-local URL).
// Safety rails, all mandatory:
//   1. the URL must be https://ubjuyeccioflhpcpnhmo.supabase.co (assertAuthorizedSupabaseTarget) — any other project aborts the run
//   2. HOSTED_TEST_CONFIRM must equal that project ref (an explicit, per-run opt-in; never set it in a file)
//   3. every fixture is tagged (email domain / title prefix), created through the Auth admin API with a random password,
//      and deleted afterwards — real customer rows are never read for assertions beyond emptiness checks, never modified.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF } from '../../shared/utils/supabaseTarget'
import type { Database } from '../../shared/types/database.types'

const envFile = new URL(`../../${process.env.HOSTED_ENV_FILE ?? '.env.hosted'}`, import.meta.url)
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
) as Record<string, string>

export const SUPABASE_URL = env.NUXT_PUBLIC_SUPABASE_URL!
const target = assertAuthorizedSupabaseTarget(SUPABASE_URL)
// Rehearsal mode: `HOSTED_ENV_FILE=.env HOSTED_TEST_ALLOW_LOCAL=1` runs the same assertions against the LOCAL stack (same schema) to prove them first.
export const rehearsal = target.kind === 'local' && process.env.HOSTED_TEST_ALLOW_LOCAL === '1'
if (target.kind !== 'hosted' && !rehearsal) throw new Error('hosted tests need the hosted project URL in .env.hosted (set HOSTED_TEST_ALLOW_LOCAL=1 to rehearse on the local stack)')
if (!rehearsal && process.env.HOSTED_TEST_CONFIRM !== AUTHORIZED_SUPABASE_REF) {
  throw new Error(`refusing to run: set HOSTED_TEST_CONFIRM=${AUTHORIZED_SUPABASE_REF} for this run to confirm you intend to test the hosted project`)
}
if (!env.NUXT_PUBLIC_SUPABASE_KEY || !env.NUXT_SUPABASE_SECRET_KEY || env.NUXT_PUBLIC_SUPABASE_KEY.startsWith('<')) throw new Error('.env.hosted keys are not filled in')

export const PUBLISHABLE_KEY = env.NUXT_PUBLIC_SUPABASE_KEY
export const FIXTURE_DOMAIN = 'hosted-test.aawraq.invalid'
export const FIXTURE_TITLE_PREFIX = '__hosted_test__'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
export type Db = SupabaseClient<Database>

export const anonClient = (): Db => createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, opts)
export const serviceClient = (): Db => createClient<Database>(SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY!, opts)

export interface Fixture { id: string; email: string; client: Db; accessToken: string }

/** Confirmed user with a random password (never logged, never reused). The `handle_new_user` trigger creates the profile. */
export async function createFixtureUser(svc: Db, label: string): Promise<Fixture> {
  const email = `${label}-${randomUUID().slice(0, 8)}@${FIXTURE_DOMAIN}`
  const password = randomBytes(24).toString('base64url') + 'aA1!'
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `${FIXTURE_TITLE_PREFIX}${label}` } })
  if (error || !data.user) throw new Error(`fixture user ${label}: ${error?.message}`)
  const client = anonClient()
  const signed = await client.auth.signInWithPassword({ email, password })
  if (signed.error || !signed.data.session) throw new Error(`fixture sign-in ${label}: ${signed.error?.message}`)
  return { id: data.user.id, email, client, accessToken: signed.data.session.access_token }
}

/** Removes fixtures from this run AND from any earlier aborted run (matched by the reserved email domain / title / name prefix only). */
export async function cleanupFixtures(svc: Db) {
  const books = await svc.from('books').select('id').like('title', `${FIXTURE_TITLE_PREFIX}%`)
  const ids = (books.data ?? []).map((b) => b.id)
  if (ids.length) {
    await svc.from('book_media').delete().in('book_id', ids)
    await svc.from('books').delete().in('id', ids)
    await svc.from('audit_log').delete().eq('entity', 'books').in('entity_id', ids.map(String)) // best effort: leave no trace of fixtures
  }
  // categories / makers created through the admin API by the integration test (name prefix only)
  for (const table of ['categories', 'makers'] as const) {
    const rows = await svc.from(table).select('id').like('name', `${FIXTURE_TITLE_PREFIX}%`)
    const rowIds = (rows.data ?? []).map((r) => r.id)
    if (rowIds.length) {
      await svc.from(table).delete().in('id', rowIds)
      await svc.from('audit_log').delete().eq('entity', table).in('entity_id', rowIds.map(String))
    }
  }
  for (let page = 1; page <= 5; page++) {
    const { data } = await svc.auth.admin.listUsers({ page, perPage: 200 })
    const stale = (data?.users ?? []).filter((u) => (u.email ?? '').endsWith(`@${FIXTURE_DOMAIN}`))
    for (const u of stale) {
      await svc.from('user_roles').delete().eq('user_id', u.id)
      await svc.from('favourites').delete().eq('user_id', u.id)
      await svc.from('comments').delete().eq('user_id', u.id)
      await svc.auth.admin.deleteUser(u.id)
    }
    if (stale.length) {
      // the user_roles audit trigger records the synthetic admin grant/revoke without a row id: match by OUR fixture user ids only
      const list = stale.map((u) => u.id).join(',')
      await svc.from('audit_log').delete().eq('entity', 'user_roles').or(`diff->new->>user_id.in.(${list}),diff->old->>user_id.in.(${list})`)
    }
    if ((data?.users ?? []).length < 200) break
  }
}

export const rest = (path: string, token: string | null, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token ?? PUBLISHABLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers as Record<string, string>) } })

// ---- Nuxt app access (the app under test runs separately, started with `--dotenv .env.hosted`) ---------------------------------
export const APP_URL = process.env.TEST_APP_URL ?? 'http://localhost:3100'

/** Cookie header carrying a Supabase session so Nitro sees the user (format of @supabase/ssr: sb-<ref>-auth-token, chunked at 3180). */
export function sessionCookieHeader(session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; token_type?: string; user?: unknown }) {
  const prefix = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  const size = 3180
  if (value.length <= size) return `${prefix}=${value}`
  const parts: string[] = []
  for (let i = 0; i * size < value.length; i++) parts.push(`${prefix}.${i}=${value.slice(i * size, (i + 1) * size)}`)
  return parts.join('; ')
}

/** HTTP client against the running Nuxt app. Each client gets its own source IP so the per-IP in-memory rate limiter stays decoupled. */
export async function appAs(user: Fixture | null) {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
  let cookie = ''
  if (user) {
    const { data } = await user.client.auth.getSession()
    cookie = sessionCookieHeader(data.session!)
  }
  return (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    headers.set('x-forwarded-for', ip)
    if (cookie) headers.set('cookie', cookie)
    let body = init.body
    if (init.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.json) }
    return fetch(`${APP_URL}${path}`, { ...init, headers, body, redirect: 'manual' })
  }
}
