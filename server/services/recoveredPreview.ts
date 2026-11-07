import type { H3Event } from 'h3'
import { escapeLike, previewItemFromRow, type RecoveredPreviewItem } from '~~/shared/utils/recoveredPreview'
import { serviceClient } from '../utils/supabase'

export const RECOVERED_PAGE_SIZE = 24

/**
 * The recovered catalogue is review material, not part of the store. It is exposed ONLY while the site is a protected preview (everything is behind the password
 * gate), and never when the site is public: a future public launch cannot leak drafts through this path by forgetting a switch. The normal catalogue keeps its own
 * rules (row-level security shows published books only); nothing here relaxes them.
 */
export function recoveredPreviewEnabled(event: H3Event): boolean {
  return normaliseMode(useRuntimeConfig(event).previewMode, process.env.NODE_ENV === 'production') === 'protected'
}

/** Draft, recovered, not demo, not deleted, and every evidence check passed: the same rule as `passesEvidenceChecks`, applied in the database so counts and pages agree. */
const eligibleOnly = <Q extends { eq: (c: string, v: string | boolean) => Q; is: (c: string, v: null) => Q }>(q: Q): Q => q
  .eq('provenance', 'recovered_media').eq('is_demo', false).eq('status', 'draft').is('deleted_at', null)
  .eq('recovery_evidence->checks->>malware_scan', 'clean')
  .eq('recovery_evidence->checks->>hash_verified', 'true')
  .eq('recovery_evidence->checks->>size_verified', 'true')
  .eq('recovery_evidence->checks->>encrypted', 'false')
  .eq('recovery_evidence->checks->>active_content', 'none found')

const failure = () => createError({ statusCode: 500, statusMessage: 'تعذر تحميل الكتالوج المستعاد' })

export async function recoveredTotal(event: H3Event): Promise<number> {
  const { count, error } = await eligibleOnly(serviceClient(event).from('books').select('id', { count: 'exact', head: true }))
  if (error) throw failure()
  return count ?? 0
}

export async function recoveredPage(event: H3Event, opts: { page: number; size: number; search: string }): Promise<{ items: RecoveredPreviewItem[]; total: number; page: number; pageCount: number }> {
  const size = Math.min(Math.max(1, opts.size), RECOVERED_PAGE_SIZE)
  const page = Math.max(1, opts.page)
  const from = (page - 1) * size
  let q = eligibleOnly(serviceClient(event).from('books').select('id,title,cover_path,recovery_evidence', { count: 'exact' }))
  if (opts.search) q = q.ilike('title', `%${escapeLike(opts.search)}%`)
  const { data, count, error } = await q.order('id', { ascending: true }).range(from, from + size - 1)
  if (error) throw failure()
  const total = count ?? 0
  return { items: (data ?? []).map((r) => previewItemFromRow(r as never)).filter((x): x is RecoveredPreviewItem => x !== null), total, page, pageCount: Math.max(1, Math.ceil(total / size)) }
}
