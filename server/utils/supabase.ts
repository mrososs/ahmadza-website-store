import type { H3Event } from 'h3'
import { serverSupabaseClient, serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import type { Database } from '~~/shared/types/database.types'
import { forbidden, unauthorized } from './errors'

/** Service-role client: bypasses RLS. Use ONLY after an explicit authorisation check, never with raw client input. */
export const serviceClient = (event: H3Event) => serverSupabaseServiceRole<Database>(event)
/** User-scoped client: RLS applies with the caller's JWT. */
export const userClient = (event: H3Event) => serverSupabaseClient<Database>(event)

export interface AuthedUser { id: string; email: string | null }

export async function getOptionalUser(event: H3Event): Promise<AuthedUser | null> {
  try {
    const u = await serverSupabaseUser(event)
    if (!u?.sub) return null
    return { id: u.sub, email: (u as { email?: string }).email ?? null }
  } catch { return null }
}

export async function requireUser(event: H3Event): Promise<AuthedUser> {
  const u = await getOptionalUser(event)
  if (!u) throw unauthorized()
  return u
}

/** Role comes from public.user_roles via the SECURITY DEFINER is_admin() — never from client-editable metadata. */
export async function requireAdmin(event: H3Event): Promise<AuthedUser> {
  const u = await requireUser(event)
  const { data, error } = await (await userClient(event)).rpc('is_admin')
  if (error || data !== true) throw forbidden('هذه الصفحة للمدير فقط')
  return u
}

export async function requireAffiliate(event: H3Event): Promise<AuthedUser> {
  const u = await requireUser(event)
  const { data } = await serviceClient(event).from('profiles').select('is_affiliate,status').eq('id', u.id).maybeSingle()
  if (!data?.is_affiliate || data.status !== 'active') throw forbidden('هذه الصفحة للمسوّقين فقط')
  return u
}
