// Attach already-staged media to books WITHOUT re-uploading: a server-side Storage copy inside the same project
// (legacy-staging -> private-products), same bytes / same SHA-256, then a book_media row + staging row update.
import { randomUUID } from 'node:crypto'
import { EXT_FOR_TYPE } from './supabase.mjs'

/**
 * @typedef {{ legacy_path: string, book_id: number, visibility?: 'preview'|'after_purchase', name?: string,
 *            kind?: 'file'|'audio', sort_order?: number, page_count?: number, legacy_book_media_id?: number }} MediaMapping
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {MediaMapping[]} mappings
 * @param {{ dryRun?: boolean }} opts
 */
export async function linkMedia(db, mappings, { dryRun = false } = {}) {
  const report = { linked: [], skipped: [], failed: [] }
  for (const m of mappings) {
    try {
      const { data: st, error } = await db.from('legacy_media_staging').select('*').eq('legacy_path', m.legacy_path).maybeSingle()
      if (error) throw error
      if (!st) { report.skipped.push({ legacy_path: m.legacy_path, reason: 'not in staging inventory' }); continue }
      if (m.legacy_book_media_id != null) {
        const { data: dup } = await db.from('book_media').select('id').eq('legacy_book_media_id', m.legacy_book_media_id).maybeSingle()
        if (dup) { report.skipped.push({ legacy_path: m.legacy_path, reason: 'already imported (legacy_book_media_id)' }); continue }
      }
      if (st.status === 'linked' && st.book_media_id) {
        // two legacy book_media rows -> one physical file (same-second collision, docs/09 §3.3): keep both rows, share the object
        const { data: first } = await db.from('book_media').select('storage_path,mime_type,byte_size,sha256,extension').eq('id', st.book_media_id).single()
        if (dryRun) { report.linked.push({ legacy_path: m.legacy_path, shared_object: first.storage_path, dry_run: true }); continue }
        const { data: media, error: shErr } = await db.from('book_media').insert({
          book_id: m.book_id, kind: m.kind ?? 'file', visibility: m.visibility ?? 'after_purchase', name: m.name ?? '', extension: first.extension,
          page_count: m.page_count ?? 0, sort_order: m.sort_order ?? 0, storage_path: first.storage_path, mime_type: first.mime_type,
          byte_size: first.byte_size, sha256: first.sha256, legacy_path: st.legacy_path, legacy_book_media_id: m.legacy_book_media_id ?? null,
        }).select('id').single()
        if (shErr) throw shErr
        report.linked.push({ legacy_path: m.legacy_path, book_media_id: media.id, shared_object: first.storage_path })
        continue
      }
      if (st.status !== 'staged' || !st.storage_path) { report.skipped.push({ legacy_path: m.legacy_path, reason: `staging status is ${st.status} (only staged, verified objects can be linked)` }); continue }
      const { data: book } = await db.from('books').select('id').eq('id', m.book_id).maybeSingle()
      if (!book) { report.skipped.push({ legacy_path: m.legacy_path, reason: `book ${m.book_id} does not exist` }); continue }

      const ext = EXT_FOR_TYPE[st.detected_type]
      const dest = `books/${m.book_id}/${randomUUID()}.${ext}`
      if (dryRun) { report.linked.push({ legacy_path: m.legacy_path, dest, dry_run: true }); continue }

      const { error: cpErr } = await db.storage.from('legacy-staging').copy(st.storage_path, dest, { destinationBucket: 'private-products' })
      if (cpErr) throw cpErr
      const { data: media, error: insErr } = await db.from('book_media').insert({
        book_id: m.book_id, kind: m.kind ?? (st.detected_type === 'mp3' ? 'audio' : 'file'),
        visibility: m.visibility ?? 'after_purchase', name: m.name ?? '', extension: ext, page_count: m.page_count ?? 0,
        sort_order: m.sort_order ?? 0, storage_path: dest, mime_type: st.mime_type, byte_size: st.byte_size, sha256: st.sha256,
        legacy_path: st.legacy_path, legacy_book_media_id: m.legacy_book_media_id ?? null,
      }).select('id').single()
      if (insErr) { await db.storage.from('private-products').remove([dest]); throw insErr }
      const { error: upErr } = await db.from('legacy_media_staging').update({
        status: 'linked', book_media_id: media.id, updated_at: new Date().toISOString(),
      }).eq('id', st.id)
      if (upErr) throw upErr
      report.linked.push({ legacy_path: m.legacy_path, book_media_id: media.id, dest })
    } catch (e) { report.failed.push({ legacy_path: m.legacy_path, error: String(e.message ?? e) }) }
  }
  return report
}
