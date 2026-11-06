import type { H3Event } from 'h3'
import { userClient } from './supabase'

/** True when the caller holds the database-managed admin role (public.is_admin()). */
export async function callerIsAdmin(event: H3Event): Promise<boolean> {
  const { data, error } = await (await userClient(event)).rpc('is_admin')
  return !error && data === true
}
