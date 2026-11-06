import type { H3Event } from 'h3'
import { getRequestIP } from 'h3'
import { tooMany } from './errors'

// Small in-memory fixed-window limiter (per server instance). Replace with a shared store (Redis / Supabase)
// before running more than one instance — listed in docs/implementation/10-remaining-blockers.md.
const buckets = new Map<string, { count: number; reset: number }>()

export function rateLimit(event: H3Event, key: string, limit: number, windowMs: number) {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const id = `${key}:${ip}`
  const now = Date.now()
  const b = buckets.get(id)
  if (!b || b.reset < now) { buckets.set(id, { count: 1, reset: now + windowMs }); return }
  b.count += 1
  if (b.count > limit) throw tooMany()
}
