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
    fetchAll((a, b) => db.from('books_readiness').select('book_id,status,eligible,reasons,legacy_verified_at,import_run_id,media_total,media_validated,workflow_status,provenance').in('provenance', ['legacy', 'recovered_media']).order('book_id').range(a, b)),
    db.from('migration_runs').select('id,kind,started_at,finished_at,dry_run,notes').eq('dry_run', false).order('id', { ascending: false }).limit(10),
    fetchAll((a, b) => db.from('book_media_readiness').select('media_id,migration_status,validated').order('media_id').range(a, b)),
    fetchAll((a, b) => db.from('migration_rejects').select('id,entity,reason').order('id').range(a, b)),
  ])
  if (runs.error) dbFail(runs.error)

  const byStatus: Record<string, number> = {}
  const byWorkflow: Record<string, number> = {}
  const byProvenance: Record<string, number> = {}
  const blockers = new Map<string, number>()
  const perRun = new Map<number, { books: number; verified: number; eligible: number }>()
  let verified = 0, eligible = 0, withoutMedia = 0
  for (const r of rows) {
    byStatus[r.status ?? 'unknown'] = (byStatus[r.status ?? 'unknown'] ?? 0) + 1
    byWorkflow[r.workflow_status ?? 'unknown'] = (byWorkflow[r.workflow_status ?? 'unknown'] ?? 0) + 1
    byProvenance[r.provenance ?? 'unknown'] = (byProvenance[r.provenance ?? 'unknown'] ?? 0) + 1
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
    books: { recovered: rows.length, by_status: byStatus, by_workflow: byWorkflow, by_provenance: byProvenance, verified, unverified: rows.length - verified, eligible, blocked: rows.length - eligible, without_validated_media: withoutMedia },
    blockers: [...blockers.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, label: readinessReasonLabel(reason), count })),
    media: { total: mediaRows.length, validated: mediaValidated, by_status: mediaByStatus },
    rejects: { total: rejects.length, by_entity: rejectsByEntity, by_reason: rejectsByReason },
    runs: (runs.data ?? []).map((r) => ({ ...r, ...(perRun.get(r.id) ?? { books: 0, verified: 0, eligible: 0 }), failed: (r.notes ?? '').startsWith('FAILED') })),
  }
}

/**
 * The review queue: recovered books (database records and evidence-based drafts) that are not yet eligible, with what each one still needs. Everything shown is
 * evidence, not fact: the PDF author is labelled unverified in the UI and never becomes an author record.
 */
export async function recoveryQueue(event: H3Event, page: number, size = 25) {
  const db = serviceClient(event)
  const { data: rows, count, error } = await db.from('books_readiness').select('book_id,reasons,provenance,media_validated,workflow_status,legacy_verified_at', { count: 'exact' })
    .in('provenance', ['legacy', 'recovered_media']).eq('eligible', false).neq('status', 'published').order('book_id').range((page - 1) * size, page * size - 1)
  if (error) dbFail(error)
  const ids = (rows ?? []).map((r) => r.book_id).filter((v): v is number => v != null)
  const books = ids.length ? await db.from('books').select('id,title,status,recovery_evidence,cover_path').in('id', ids) : { data: [], error: null }
  if (books.error) dbFail(books.error)
  const byId = new Map((books.data ?? []).map((b) => [b.id, b]))
  type Evidence = { source_file?: { original_name?: string | null }; pdf?: { author?: string | null; pages?: number | null }; checks?: { malware_scan?: string } }
  return {
    items: (rows ?? []).map((r) => {
      const b = byId.get(r.book_id as number)
      const ev = (b?.recovery_evidence ?? null) as Evidence | null
      return {
        id: r.book_id, title: b?.title ?? '', provenance: r.provenance, workflow: r.workflow_status, reasons: r.reasons ?? [], verified: !!r.legacy_verified_at,
        has_cover: !!b?.cover_path, file_validated: Number(r.media_validated ?? 0) > 0,
        original_name: ev?.source_file?.original_name ?? null, pdf_author: ev?.pdf?.author ?? null, pages: ev?.pdf?.pages ?? null, scan: ev?.checks?.malware_scan ?? null,
      }
    }),
    total: count ?? 0, page, pageSize: size,
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
