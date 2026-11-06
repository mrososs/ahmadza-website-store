import type { H3Event } from 'h3'
import { getQuery, readBody, getRequestHeader } from 'h3'
import type { ZodType } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '~~/shared/types/database.types'
import { badRequest, fromDbError } from './errors'
import { rateLimit } from './rateLimit'
import { requireAdmin, serviceClient, type AuthedUser } from './supabase'

/** Untyped service-role client for the generic admin CRUD service (table name is data-driven there). */
export const adminDb = (event: H3Event) => serviceClient(event) as unknown as SupabaseClient

/** Guard for admin READ routes: 401 guest / 403 non-admin (role from public.user_roles, never from the JWT metadata). */
export async function adminRead(event: H3Event, opts: { allowAal1?: boolean } = {}): Promise<AuthedUser> {
  return requireAdmin(event, opts)
}

/** Guard for admin MUTATIONS: same as adminRead plus a light per-IP rate limit. */
export async function adminWrite(event: H3Event): Promise<AuthedUser> {
  const user = await requireAdmin(event)
  rateLimit(event, 'admin-mutation', 300, 60_000)
  return user
}

export async function parseBody<T>(event: H3Event, schema: ZodType<T>): Promise<T> {
  const raw = await readBody(event).catch(() => undefined)
  const r = schema.safeParse(raw)
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? 'بيانات غير صالحة', r.error.issues)
  return r.data
}

export function parseQuery<T>(event: H3Event, schema: ZodType<T>): T {
  const r = schema.safeParse(getQuery(event))
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? 'معاملات غير صالحة', r.error.issues)
  return r.data
}

export function intParam(event: H3Event, name: string): number {
  const v = Number(event.context.params?.[name])
  if (!Number.isInteger(v) || v < 1) throw badRequest('معرّف غير صالح')
  return v
}

/** Throw an HTTP error for a PostgREST/Postgres failure (constraint violations become 400, the rest go through fromDbError). */
export function dbFail(error: { code?: string; message?: string }): never {
  if (['23514', '23502', '22P02', '22001', '23503'].includes(error.code ?? '')) throw badRequest(error.message ?? 'بيانات غير صالحة')
  throw fromDbError(error)
}

/** Explicit audit entry with the acting admin (row triggers record the change but have no auth.uid() under service_role). */
export async function adminAudit(event: H3Event, admin: AuthedUser, action: string, entity: string, entityId: string | number, diff?: Json) {
  await serviceClient(event).from('audit_log').insert({
    actor_id: admin.id, action, entity, entity_id: String(entityId), diff: diff ?? null,
  })
}

export const contentLength = (event: H3Event) => Number(getRequestHeader(event, 'content-length') ?? 0)
