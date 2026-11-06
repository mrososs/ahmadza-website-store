// The import target policy: real recovered data and synthetic data never share a database.
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs module (no type declarations)
import { checkRecoveryStackIsClean, checkTargetPolicy, parseEnv } from '../../scripts/migration/lib/target.mjs'

const dev = { NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }
const rec = { NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321', AAWRAQ_STACK: 'recovery' }

describe('checkTargetPolicy', () => {
  it('real data -> recovery stack is allowed', () => {
    expect(checkTargetPolicy({ target: 'recovery', sourceKind: 'mariadb', targetEnv: rec, devEnv: dev })).toEqual({ ok: true, problems: [] })
  })
  it('real data -> dev stack is refused, with the reason', () => {
    const r = checkTargetPolicy({ target: 'dev', sourceKind: 'mariadb', targetEnv: dev, devEnv: dev })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/NEVER be imported into the dev database/)
  })
  it('fixture data -> recovery stack is refused; fixture -> dev is allowed', () => {
    expect(checkTargetPolicy({ target: 'recovery', sourceKind: 'fixture', targetEnv: rec, devEnv: dev }).problems.join(' ')).toMatch(/NEVER be written to the recovery stack/)
    expect(checkTargetPolicy({ target: 'dev', sourceKind: 'fixture', targetEnv: dev, devEnv: dev }).ok).toBe(true)
  })
  it('a missing or unknown --target is refused', () => {
    expect(checkTargetPolicy({ target: undefined, sourceKind: 'mariadb', targetEnv: rec, devEnv: dev }).ok).toBe(false)
    expect(checkTargetPolicy({ target: 'prod', sourceKind: 'mariadb', targetEnv: rec, devEnv: dev }).ok).toBe(false)
  })
  it('the recovery env must declare the isolated stack, be local, and differ from the dev stack', () => {
    expect(checkTargetPolicy({ target: 'recovery', sourceKind: 'mariadb', targetEnv: { NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' }, devEnv: dev }).problems.join(' ')).toMatch(/AAWRAQ_STACK=recovery/)
    expect(checkTargetPolicy({ target: 'recovery', sourceKind: 'mariadb', targetEnv: { ...rec, NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, devEnv: dev }).problems.join(' ')).toMatch(/must be different stacks/)
    expect(checkTargetPolicy({ target: 'recovery', sourceKind: 'mariadb', targetEnv: { ...rec, NUXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }, devEnv: dev }).problems.join(' ')).toMatch(/must be local/)
  })
  it('a dev env file that points at the recovery stack is refused; a missing env file is refused', () => {
    expect(checkTargetPolicy({ target: 'dev', sourceKind: 'fixture', targetEnv: rec, devEnv: dev }).ok).toBe(false)
    expect(checkTargetPolicy({ target: 'recovery', sourceKind: 'mariadb', targetEnv: null, devEnv: dev }).problems.join(' ')).toMatch(/no environment file/)
  })
})

describe('checkRecoveryStackIsClean', () => {
  it('passes only when there is no synthetic data at all', () => {
    expect(checkRecoveryStackIsClean({ demoBooks: 0, demoProvenanceBooks: 0, testUsers: 0, demoCategories: 0, demoMakers: 0 }).ok).toBe(true)
    const r = checkRecoveryStackIsClean({ demoBooks: 113, demoProvenanceBooks: 30, testUsers: 312, demoCategories: 6, demoMakers: 9 })
    expect(r.ok).toBe(false)
    expect(r.problems).toHaveLength(5)
    expect(r.problems.join(' ')).toMatch(/312 test users/)
  })
})

describe('parseEnv', () => {
  it('ignores comments and keeps values containing =', () => {
    expect(parseEnv('# c\nA=1\nB=x=y\n')).toEqual({ A: '1', B: 'x=y' })
  })
})
