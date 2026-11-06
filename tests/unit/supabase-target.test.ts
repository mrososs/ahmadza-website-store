import { describe, expect, it } from 'vitest'
import { assertAuthorizedSupabaseTarget, AUTHORIZED_SUPABASE_REF, classifySupabaseUrl } from '~~/shared/utils/supabaseTarget'

describe('supabase target guard', () => {
  it('accepts local URLs in development', () => {
    expect(assertAuthorizedSupabaseTarget('http://127.0.0.1:54321').kind).toBe('local')
    expect(assertAuthorizedSupabaseTarget('http://localhost:54321').kind).toBe('local')
  })
  it('accepts only the authorised hosted project', () => {
    const t = assertAuthorizedSupabaseTarget(`https://${AUTHORIZED_SUPABASE_REF}.supabase.co`)
    expect(t).toMatchObject({ kind: 'hosted', ref: AUTHORIZED_SUPABASE_REF })
  })
  it('refuses any other hosted project (e.g. the owner personal website project)', () => {
    expect(() => assertAuthorizedSupabaseTarget('https://abcdefghijklmnopqrst.supabase.co')).toThrow(/not the authorised/)
  })
  it('refuses plain-http hosted, look-alike hosts and malformed URLs', () => {
    expect(() => classifySupabaseUrl(`http://${AUTHORIZED_SUPABASE_REF}.supabase.co`)).toThrow()
    expect(() => classifySupabaseUrl(`https://${AUTHORIZED_SUPABASE_REF}.supabase.co.evil.example`)).toThrow()
    expect(() => classifySupabaseUrl(`https://evil.example/${AUTHORIZED_SUPABASE_REF}.supabase.co`)).toThrow()
    expect(() => classifySupabaseUrl('not a url')).toThrow()
    expect(() => classifySupabaseUrl('')).toThrow(/not configured/)
  })
  it('refuses localhost in production', () => {
    expect(() => assertAuthorizedSupabaseTarget('http://127.0.0.1:54321', { production: true })).toThrow(/production/)
    expect(assertAuthorizedSupabaseTarget(`https://${AUTHORIZED_SUPABASE_REF}.supabase.co`, { production: true }).kind).toBe('hosted')
  })
})
