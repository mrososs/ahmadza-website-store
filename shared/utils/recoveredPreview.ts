// What the protected preview may show about a RECOVERED, still unreviewed book. This is the only place that decides it: the server maps each database row through
// `previewItemFromRow` and returns nothing else. It is a whitelist, so a field added to the table later stays invisible until it is added here on purpose.
//
// Shown: the recovered title, page count and size of the file, the fixed review state, the original file name, a short file fingerprint and the scan result.
// Never shown: the storage path, any author or category (none is verified), any price (unknown), the cover (none), the PDF's own metadata, owner ids.

export interface RecoveredPreviewItem {
  id: number
  title: string
  pages: number | null
  size_bytes: number | null
  original_name: string | null
  fingerprint: string
  scan: 'clean'
}

export interface RecoveredPreviewRow { id: number; title: string; recovery_evidence: unknown }

/** The evidence checks a record must pass to be listed at all. The same conditions are applied in the database query; this is the second, independent check. */
export function passesEvidenceChecks(evidence: unknown): boolean {
  const c = (evidence as { checks?: Record<string, unknown> } | null)?.checks
  return !!c && c.malware_scan === 'clean' && c.hash_verified === true && c.size_verified === true && c.encrypted === false && c.active_content === 'none found'
}

const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

export function previewItemFromRow(row: RecoveredPreviewRow): RecoveredPreviewItem | null {
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  if (!title || !passesEvidenceChecks(row.recovery_evidence)) return null
  const ev = row.recovery_evidence as { sha256?: unknown; byte_size?: unknown; pdf?: { pages?: unknown }; source_file?: { original_name?: unknown } }
  const sha = typeof ev.sha256 === 'string' && /^[0-9a-f]{64}$/.test(ev.sha256) ? ev.sha256 : null
  if (!sha) return null
  const name = typeof ev.source_file?.original_name === 'string' ? [...ev.source_file.original_name].filter((ch) => ch.charCodeAt(0) >= 32).join('').slice(0, 200) : null // control characters dropped
  return { id: row.id, title: title.slice(0, 300), pages: intOrNull(ev.pdf?.pages), size_bytes: intOrNull(ev.byte_size), original_name: name || null, fingerprint: sha.slice(0, 12), scan: 'clean' }
}

/** Escapes the characters that act as wildcards in a PostgREST `ilike` pattern, so a search box cannot turn into a pattern. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)
