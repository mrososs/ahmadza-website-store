// Test helpers for the LOCAL Supabase stack (never hosted). Reads .env, signs in the seeded dev identities.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import type { Database } from '../../shared/types/database.types'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
) as Record<string, string>

export const SUPABASE_URL = env.NUXT_PUBLIC_SUPABASE_URL!
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SUPABASE_URL)) throw new Error('tests must target the local stack')
export const DEV_PASSWORD = 'Local-Dev-Pass-2026!'
export const APP_URL = process.env.TEST_APP_URL ?? 'http://localhost:3000'

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
export type Db = SupabaseClient<Database>

export const anonClient = (): Db => createClient<Database>(SUPABASE_URL, env.NUXT_PUBLIC_SUPABASE_KEY!, opts)
export const serviceClient = (): Db => createClient<Database>(SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY!, opts)

export async function signedInClient(email: string): Promise<{ client: Db; userId: string; accessToken: string }> {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password: DEV_PASSWORD })
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`)
  return { client, userId: data.user.id, accessToken: data.session.access_token }
}

export const DEV_USERS = {
  admin: 'admin@aawraq.test',
  customer: 'customer@aawraq.test',
  customer2: 'customer2@aawraq.test',
  affiliate: 'affiliate@aawraq.test',
  contributor: 'contributor@aawraq.test',
  banned: 'banned@aawraq.test',
} as const

/** Cookie header carrying a Supabase session so Nitro routes see the user (cookie format of @nuxtjs/supabase / @supabase/ssr). */
export function sessionCookieHeader(session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; token_type?: string; user?: unknown }) {
  const prefix = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  // @supabase/ssr chunks cookies above ~3180 chars
  const size = 3180
  if (value.length <= size) return `${prefix}=${value}`
  const parts: string[] = []
  for (let i = 0; i * size < value.length; i++) parts.push(`${prefix}.${i}=${value.slice(i * size, (i + 1) * size)}`)
  return parts.join('; ')
}

export async function apiAs(email: string | null, baseUrl: string = APP_URL) {
  // each client gets its own source IP so the per-IP in-memory rate limiter does not couple unrelated tests
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
  let cookie = ''
  if (email) {
    const client = anonClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password: DEV_PASSWORD })
    if (error || !data.session) throw new Error(error?.message)
    cookie = sessionCookieHeader(data.session)
  }
  return async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', ip)
    if (cookie) headers.set('cookie', [cookie, headers.get('cookie')].filter(Boolean).join('; ')) // merge extra cookies (e.g. aw_aff)
    let body = init.body
    if (init.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.json) }
    return fetch(`${baseUrl}${path}`, { redirect: 'manual', ...init, headers, body })
  }
}
