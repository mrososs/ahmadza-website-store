import type { H3Event } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import type { Database } from '~~/shared/types/database.types'
import { forbidden, mfaRequired, unauthorized } from './errors'

/** Service-role client: bypasses RLS. Use ONLY after an explicit authorisation check, never with raw client input. */
export const serviceClient = (event: H3Event) => serverSupabaseServiceRole<Database>(event)
/** User-scoped client: RLS applies with the caller's JWT. */
export const userClient = (event: H3Event) => serverSupabaseClient<Database>(event)

export interface AuthedUser { id: string; email: string | null; /** Supabase Auth assurance level of THIS session: aal1 = password only, aal2 = second factor passed. */ aal?: string }

export async function getOptionalUser(event: H3Event): Promise<AuthedUser | null> {
  try {
    const u = await serverSupabaseUser(event)
    if (!u?.sub) return null
    return { id: u.sub, email: (u as { email?: string }).email ?? null, aal: (u as { aal?: string }).aal }
  } catch { return null }
}

export async function requireUser(event: H3Event): Promise<AuthedUser> {
  const u = await getOptionalUser(event)
  if (!u) throw unauthorized()
  return u
}

/** Role comes from public.user_roles via the SECURITY DEFINER is_admin() — never from client-editable metadata. */
export async function requireAdmin(event: H3Event, opts: { allowAal1?: boolean } = {}): Promise<AuthedUser> {
  const u = await requireUser(event)
  const { data, error } = await (await userClient(event)).rpc('is_admin')
  if (error || data !== true) throw forbidden('هذه الصفحة للمدير فقط')
  // Second factor: when required (production default, NUXT_ADMIN_REQUIRE_MFA) an administrator session must be aal2. Only /api/admin/me may answer at aal1,
  // so the UI can send the admin to the enrolment / verification page.
  if (!opts.allowAal1 && adminMfaRequired(event) && u.aal !== 'aal2') throw mfaRequired()
  return u
}

export function adminMfaRequired(event: H3Event): boolean {
  const v = (useRuntimeConfig(event) as { adminRequireMfa?: unknown }).adminRequireMfa
  return v === true || String(v).toLowerCase() === 'true'
}

export async function requireAffiliate(event: H3Event): Promise<AuthedUser> {
  const u = await requireUser(event)
  const { data } = await serviceClient(event).from('profiles').select('is_affiliate,status').eq('id', u.id).maybeSingle()
  if (!data?.is_affiliate || data.status !== 'active') throw forbidden('هذه الصفحة للمسوّقين فقط')
  return u
}
