// scripts/admin/bootstrap-admin.mjs against the LOCAL stack: invite -> (user confirms) -> grant -> admin dashboard reachable.
// Also proves the safety rails: no password option, no grant before confirmation, hosted target refused without explicit flags.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { apiAs, DEV_PASSWORD, serviceClient } from '../helpers/supabase'

const svc = serviceClient()
const script = new URL('../../scripts/admin/bootstrap-admin.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const email = `bootstrap-${Date.now()}@aawraq.test`
let userId = ''
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

afterAll(async () => {
  if (userId) {
    await svc.from('user_roles').delete().eq('user_id', userId)
    await svc.auth.admin.deleteUser(userId)
  }
})

describe('bootstrap-admin.mjs (local)', () => {
  it('refuses a password argument, ambiguous actions and bad e-mails', () => {
    expect(run('--email', email, '--invite', '--password', 'x').stderr).toMatch(/never accepts a password/)
    expect(run('--email', email).stderr).toMatch(/exactly one of --invite or --grant/)
    expect(run('--email', 'not-an-email', '--invite').status).toBe(1)
  })

  it('refuses a hosted target unless the project is confirmed explicitly (before any network call)', () => {
    if (!existsSync(new URL('../../.env.hosted', import.meta.url))) return
    const r = run('--email', email, '--grant', '--env', '.env.hosted')
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/requires --confirm-project ubjuyeccioflhpcpnhmo/)
    expect(run('--email', email, '--grant', '--env', '.env.hosted', '--confirm-project', 'ubjuyeccioflhpcpnhmo').stderr).toMatch(/requires --yes/)
    expect(run('--email', email, '--grant', '--env', '.env.hosted', '--confirm-project', 'someotherprojectref0', '--yes').stderr).toMatch(/requires --confirm-project ubjuyeccioflhpcpnhmo/)
  })

  it('refuses to grant a user that does not exist or has not confirmed', async () => {
    expect(run('--email', email, '--grant').stderr).toMatch(/no such user/)
    const inv = run('--email', email, '--invite')
    expect(inv.status, inv.stderr).toBe(0)
    expect(inv.stdout).toMatch(/invitation sent/)
    userId = (await svc.auth.admin.listUsers({ perPage: 200 })).data.users.find((u) => u.email === email)!.id
    expect(run('--email', email, '--grant').stderr).toMatch(/not confirmed/)
    expect((await svc.from('user_roles').select('user_id').eq('user_id', userId)).data).toHaveLength(0)
  })

  it('after the invited user confirms, --grant adds the admin role, audited, and the admin API opens', async () => {
    // the invitee would set their own password through the e-mailed link; the test does it with the service role
    await svc.auth.admin.updateUserById(userId, { password: DEV_PASSWORD, email_confirm: true })
    const api = await apiAs(email)
    expect((await api('/api/admin/dashboard')).status).toBe(403)       // confirmed but not an admin yet
    const g = run('--email', email, '--grant')
    expect(g.status, g.stderr).toBe(0)
    expect(g.stdout).toMatch(/granted role "admin"/)
    expect((await svc.from('user_roles').select('role').eq('user_id', userId)).data).toEqual([{ role: 'admin' }])
    expect((await api('/api/admin/dashboard')).status).toBe(200)
    expect((await api('/api/admin/me')).status).toBe(200)
    const audit = await svc.from('audit_log').select('action').eq('entity', 'user_roles').contains('diff', { new: { user_id: userId } })
    expect((audit.data ?? []).map((a) => a.action)).toContain('insert')
    expect(g.stdout + g.stderr).not.toMatch(/sb_secret|eyJ/)             // never prints the service key
  })
})
