// Controlled administrator bootstrap. There is NO password argument and no hardcoded credential anywhere.
//
//   1. Invite a person (they choose their own password through the e-mailed link):
//        node scripts/admin/bootstrap-admin.mjs --email owner@example.com --invite
//   2. After they have confirmed their account, grant the role (a trusted, audited database write):
//        node scripts/admin/bootstrap-admin.mjs --email owner@example.com --grant
//
// Target selection:  --env .env (local, default)  |  --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo --yes
// The service-role key is read from the git-ignored env file and never printed.
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAuthorizedSupabaseTarget } from '../../shared/utils/supabaseTarget.ts'

const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const has = (name) => args.includes(name)
const die = (m) => { console.error(`error: ${m}`); process.exit(1) }

const email = opt('--email')?.trim().toLowerCase()
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) die('--email <address> is required')
if (has('--password')) die('this script never accepts a password: use --invite and let the user set their own')
if (has('--invite') === has('--grant')) die('choose exactly one of --invite or --grant')

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const envPath = resolve(root, opt('--env') ?? '.env')
if (!existsSync(envPath)) die(`env file not found: ${envPath}`)
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))

let target
try { target = assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL) } catch (e) { die(e.message) }
if (target.kind === 'hosted') {
  if (opt('--confirm-project') !== target.ref) die(`hosted target requires --confirm-project ${target.ref}`)
  if (!has('--yes')) die('hosted target requires --yes after reviewing the summary below')
}
if (!env.NUXT_SUPABASE_SECRET_KEY || env.NUXT_SUPABASE_SECRET_KEY.startsWith('<')) die('NUXT_SUPABASE_SECRET_KEY is not set in the env file')
console.log(`target: ${target.kind === 'hosted' ? `HOSTED ${target.ref}` : 'local stack'}   action: ${has('--invite') ? 'invite' : 'grant admin'}   user: ${email}`)

const admin = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function findUser() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) die(error.message)
    const u = data.users.find((x) => x.email?.toLowerCase() === email)
    if (u) return u
    if (data.users.length < 200) return null
  }
  return null
}

if (has('--invite')) {
  const redirectTo = `${env.NUXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'}/confirm`
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (error) die(error.message)
  console.log(`invitation sent to ${email} (user id ${data.user.id}). They must open the link and set a password.`)
  console.log('next: after they confirm, run the same command with --grant')
} else {
  const user = await findUser()
  if (!user) die('no such user — invite them first (--invite)')
  if (!user.email_confirmed_at) die('the account has not confirmed its e-mail yet')
  const { error } = await admin.from('user_roles').upsert({ user_id: user.id, role: 'admin' }, { onConflict: 'user_id,role' })
  if (error) die(error.message)
  console.log(`granted role "admin" to ${email} (${user.id}); the change is recorded in audit_log.`)
  console.log('reminder: enrol a TOTP factor for this account BEFORE turning on site_settings.require_admin_mfa, otherwise the admin is locked out.')
}
