import type { H3Event } from 'h3'
import { readinessReasonLabel } from '~~/shared/constants/recovery'
import { serviceClient } from '../utils/supabase'
import { dbFail } from '../utils/adminRoute'

const PAGE = 1000

/** Page through a PostgREST query (default max-rows is 1000). */
async function fetchAll<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) dbFail(error)
    out.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) return out
  }
}

/** Reconciliation dashboard: what was imported, what is blocked and why, which media is missing. Counts only, no customer data. */
export async function recoverySummary(event: H3Event) {
  const db = serviceClient(event)
  const [rows, runs, mediaRows, rejects] = await Promise.all([
    fetchAll((a, b) => db.from('books_readiness').select('book_id,status,eligible,reasons,legacy_verified_at,import_run_id,media_total,media_validated').eq('provenance', 'legacy').order('book_id').range(a, b)),
    db.from('migration_runs').select('id,kind,started_at,finished_at,dry_run,notes').eq('dry_run', false).order('id', { ascending: false }).limit(10),
    fetchAll((a, b) => db.from('book_media_readiness').select('media_id,migration_status,validated').order('media_id').range(a, b)),
    fetchAll((a, b) => db.from('migration_rejects').select('id,entity,reason').order('id').range(a, b)),
  ])
  if (runs.error) dbFail(runs.error)

  const byStatus: Record<string, number> = {}
  const blockers = new Map<string, number>()
  const perRun = new Map<number, { books: number; verified: number; eligible: number }>()
  let verified = 0, eligible = 0, withoutMedia = 0
  for (const r of rows) {
    byStatus[r.status ?? 'unknown'] = (byStatus[r.status ?? 'unknown'] ?? 0) + 1
    if (r.legacy_verified_at) verified++
    if (r.eligible) eligible++
    if (Number(r.media_validated ?? 0) === 0) withoutMedia++
    for (const reason of r.reasons ?? []) blockers.set(reason, (blockers.get(reason) ?? 0) + 1)
    if (r.import_run_id != null) {
      const x = perRun.get(r.import_run_id) ?? { books: 0, verified: 0, eligible: 0 }
      x.books++; if (r.legacy_verified_at) x.verified++; if (r.eligible) x.eligible++
      perRun.set(r.import_run_id, x)
    }
  }
  const mediaByStatus: Record<string, number> = {}
  let mediaValidated = 0
  for (const m of mediaRows) { mediaByStatus[m.migration_status] = (mediaByStatus[m.migration_status] ?? 0) + 1; if (m.validated) mediaValidated++ }
  const rejectsByEntity: Record<string, number> = {}, rejectsByReason: Record<string, number> = {}
  for (const r of rejects) { rejectsByEntity[r.entity] = (rejectsByEntity[r.entity] ?? 0) + 1; rejectsByReason[r.reason] = (rejectsByReason[r.reason] ?? 0) + 1 }

  return {
    books: { recovered: rows.length, by_status: byStatus, verified, unverified: rows.length - verified, eligible, blocked: rows.length - eligible, without_validated_media: withoutMedia },
    blockers: [...blockers.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, label: readinessReasonLabel(reason), count })),
    media: { total: mediaRows.length, validated: mediaValidated, by_status: mediaByStatus },
    rejects: { total: rejects.length, by_entity: rejectsByEntity, by_reason: rejectsByReason },
    runs: (runs.data ?? []).map((r) => ({ ...r, ...(perRun.get(r.id) ?? { books: 0, verified: 0, eligible: 0 }), failed: (r.notes ?? '').startsWith('FAILED') })),
  }
}

/** Rejected source rows. `payload` can hold raw legacy values, so only entity, legacy id and reason are returned. */
export async function recoveryRejects(event: H3Event, page: number, size = 50) {
  const { data, count, error } = await serviceClient(event).from('migration_rejects')
    .select('id,run_id,entity,legacy_id,reason', { count: 'exact' }).order('id', { ascending: false }).range((page - 1) * size, page * size - 1)
  if (error) dbFail(error)
  return { items: data ?? [], total: count ?? 0, page, pageSize: size }
}

export async function verifyRun(event: H3Event, run: number, adminId: string) {
  const { data, error } = await serviceClient(event).rpc('verify_legacy_run', { p_run: run, p_admin: adminId })
  if (error) dbFail(error)
  return { verified: data ?? 0 }
}

export async function promoteEligible(event: H3Event, run: number | undefined) {
  const { data, error } = await serviceClient(event).rpc('promote_eligible_books', run ? { p_run: run } : {})
  if (error) dbFail(error)
  return { promoted: (data ?? []).length, books: (data ?? []).map((r) => ({ id: r.book_id, status: r.new_status })) }
}
