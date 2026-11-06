import type { H3Event } from 'h3'
import { serviceClient } from './supabase'

/** Append an administrative action to public.audit_log (service role; the table has no Data API write path). */
export async function audit(event: H3Event, actorId: string, action: string, entity: string, entityId: string, diff: Record<string, unknown> = {}) {
  await serviceClient(event).from('audit_log').insert({ actor_id: actorId, action, entity, entity_id: entityId, diff: diff as never })
}
