// Guard against pointing this application at the wrong Supabase project.
// The ONLY hosted project authorised for AAWRAQ is AUTHORIZED_SUPABASE_REF. Any other *.supabase.co host
// (for example the owner's personal-website project) must never be reachable from this codebase.
export const AUTHORIZED_SUPABASE_REF = 'ubjuyeccioflhpcpnhmo'

export type SupabaseTarget = { kind: 'local'; host: string } | { kind: 'hosted'; ref: string; host: string }

export function classifySupabaseUrl(url: string | undefined | null): SupabaseTarget {
  if (!url) throw new Error('Supabase URL is not configured (NUXT_PUBLIC_SUPABASE_URL).')
  let u: URL
  try { u = new URL(url) } catch { throw new Error(`Supabase URL is not a valid URL: ${url}`) }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return { kind: 'local', host }
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(host)
  if (m && u.protocol === 'https:') return { kind: 'hosted', ref: m[1]!, host }
  throw new Error(`Refusing Supabase host "${host}": only localhost or https://<ref>.supabase.co are recognised.`)
}

/**
 * Throws unless the URL is local, or the authorised AAWRAQ project. In production a local URL is also refused
 * (a deployment must never silently run against localhost).
 */
export function assertAuthorizedSupabaseTarget(url: string | undefined | null, opts: { production?: boolean; allowedRef?: string } = {}): SupabaseTarget {
  const allowed = opts.allowedRef ?? AUTHORIZED_SUPABASE_REF
  const t = classifySupabaseUrl(url)
  if (t.kind === 'hosted' && t.ref !== allowed) {
    throw new Error(`Refusing to start: Supabase project "${t.ref}" is not the authorised AAWRAQ project ("${allowed}").`)
  }
  if (t.kind === 'local' && opts.production) {
    throw new Error('Refusing to start in production against a local Supabase URL.')
  }
  return t
}
