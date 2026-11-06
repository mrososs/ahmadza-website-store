// Read-mostly verification of the hosted Supabase Auth configuration. Sends NO e-mail and never prints tokens or keys.
//   node scripts/admin/verify-hosted-auth.mjs --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo [--preview-origin https://<the real protected-preview origin>]
// With --preview-origin the script also proves that exact origin is the Site URL / is on the redirect allow-list for the three
// callback URLs the app uses, and that a look-alike origin is refused. The origin is NEVER defaulted or guessed.
// Checks: public /auth/v1/settings (sign-ups, e-mail confirmation, enabled providers) and the effective redirect allow-list,
// by asking the admin API to GENERATE (not send) recovery links for one synthetic user, which is deleted afterwards.
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAuthorizedSupabaseTarget } from '../../shared/utils/supabaseTarget.ts'

const args = process.argv.slice(2)
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const env = Object.fromEntries(readFileSync(resolve(root, opt('--env') ?? '.env.hosted'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const target = assertAuthorizedSupabaseTarget(env.NUXT_PUBLIC_SUPABASE_URL)
if (target.kind !== 'hosted' || opt('--confirm-project') !== target.ref) { console.error(`refusing: needs the hosted target and --confirm-project ${target.ref ?? '<ref>'}`); process.exit(1) }
console.log(`target: ${target.ref}`)

const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }

const res = await fetch(`${env.NUXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.NUXT_PUBLIC_SUPABASE_KEY } })
const s = await res.json()
const providers = Object.entries(s.external ?? {}).filter(([k, v]) => v === true && k !== 'email').map(([k]) => k)
check('e-mail provider enabled', s.external?.email === true)
check('sign-ups enabled (customers register themselves)', s.disable_signup === false)
check('e-mail confirmation REQUIRED (autoconfirm off)', s.mailer_autoconfirm === false)
check('phone sign-in not enabled', s.external?.phone !== true)
check('no social/SSO providers enabled', providers.length === 0, providers.join(',') || 'none')
check('anonymous sign-ins off', s.external?.anonymous_users !== true && s.anonymous_users !== true)

// validated BEFORE anything is created, so a bad argument can never leave a synthetic user behind
const previewOrigin = opt('--preview-origin')?.replace(/\/$/, '')
if (previewOrigin && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(previewOrigin)) { console.error('--preview-origin must be an https origin without a path'); process.exit(1) }
const urls = ['http://127.0.0.1:3000/confirm?next=/reset-password', 'http://localhost:3000/confirm', 'https://attacker.invalid/steal']
if (previewOrigin) urls.push(`${previewOrigin}/confirm`, `${previewOrigin}/confirm?next=/reset-password`, `${previewOrigin}/confirm?next=/affiliate-register`, `${previewOrigin.replace('https://', 'https://evil-')}/confirm`)

const admin = createClient(env.NUXT_PUBLIC_SUPABASE_URL, env.NUXT_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const email = `auth-check-${randomUUID().slice(0, 8)}@hosted-test.aawraq.invalid`
const created = await admin.auth.admin.createUser({ email, password: randomBytes(24).toString('base64url') + 'aA1!', email_confirm: true })
if (created.error) { console.error(`cannot create the synthetic user: ${created.error.message}`); process.exit(1) }
try {
  const probe = async (redirectTo) => {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    if (error) return { error: error.message }
    return { redirect: new URL(data.properties.action_link).searchParams.get('redirect_to') }
  }
  const site = await probe(undefined)
  console.log(`info  effective Site URL (used when no/invalid redirect): ${site.redirect ?? site.error}`)
  for (const url of urls) {
    const r = await probe(url)
    const allowed = r.redirect === url
    console.log(`info  redirect ${url} -> ${r.redirect ?? r.error} (${allowed ? 'ALLOWED' : 'replaced/refused'})`)
    if (url.includes('attacker')) check('a foreign redirect URL is NOT honoured', !allowed)
    if (previewOrigin && url.startsWith(previewOrigin) && url !== previewOrigin) check(`preview callback allowed: ${url.replace(previewOrigin, '<preview>')}`, allowed)
    if (previewOrigin && url.includes('evil-')) check('a look-alike origin is NOT honoured', !allowed)
  }
} finally {
  await admin.from('user_roles').delete().eq('user_id', created.data.user.id)
  await admin.auth.admin.deleteUser(created.data.user.id)
  const left = (await admin.auth.admin.listUsers({ perPage: 200 })).data.users.filter((u) => u.email === email).length
  check('synthetic user removed', left === 0)
}
process.exit(results.every(Boolean) ? 0 : 1)
