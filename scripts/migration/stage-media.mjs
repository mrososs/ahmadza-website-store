// Idempotent, resumable import of verified recovered media into the PRIVATE local bucket `legacy-staging`.
//   node scripts/migration/stage-media.mjs [--register-only] [--limit-bytes N] [--limit-files N] [--editor-limit N]
//                                          [--batch-id ID] [--dry-run] [--verify]
// Layout: sha256/<aa>/<hash>.<ext> (content addressed; duplicates are uploaded once, every legacy path keeps its own
// row in public.legacy_media_staging with duplicate_of -> canonical row). Nothing here attaches media to a book:
// without the database there is no truthful mapping (see UNMAPPED_MEDIA).
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OUT_DIR, QUARANTINE } from './lib/paths.mjs'
import { serviceClient, objectPathFor, EXT_FOR_TYPE } from './lib/supabase.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const limitBytes = Number(opt('--limit-bytes', 500 * 1024 * 1024))
const limitFiles = Number(opt('--limit-files', Infinity))
const editorLimit = Number(opt('--editor-limit', 10))
const batchId = opt('--batch-id', `batch-${new Date().toISOString().slice(0, 10)}-a`)
const dry = flag('--dry-run')
const root = opt('--quarantine', path.join(QUARANTINE, 'user-files'))
const BUCKET = 'legacy-staging'

const { db, url, anonKey } = serviceClient()
const inventory = JSON.parse(await readFile(path.join(OUT_DIR, 'inventory.json'), 'utf8'))
// eslint-disable-next-line no-irregular-whitespace -- strips a BOM written by Windows PowerShell
const av = JSON.parse((await readFile(path.join(OUT_DIR, 'defender-scan.json'), 'utf8').catch(() => 'null')).replace(/^﻿/, '')) // Windows PowerShell writes a BOM
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

async function existing() {
  const map = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('legacy_media_staging').select('id,legacy_path,status,storage_path').range(from, from + 999)
    if (error) throw error
    data.forEach((r) => map.set(r.legacy_path, r))
    if (data.length < 1000) break
  }
  return map
}

// ---- 1. register every inventoried member (rejected ones keep their reason; nothing is uploaded for them) --------
async function register() {
  const have = await existing()
  const rows = inventory.filter((r) => !have.has(r.path)).map((r) => ({
    legacy_path: r.path, sha256: r.sha256 || '0'.repeat(64), byte_size: r.size, detected_type: r.detected_type,
    scope: r.scope, mime_type: r.mime_type, status: r.accepted ? 'inventoried' : 'rejected',
    reason: r.accepted ? null : r.reasons.join('; ').slice(0, 500), batch_id: batchId,
  }))
  if (!dry) for (const part of chunk(rows, 200)) { const { error } = await db.from('legacy_media_staging').insert(part); if (error) throw error }
  return rows.length
}

// ---- 2. verify + upload a bounded batch ------------------------------------------------------------------------
async function stage() {
  if (!av?.clean) throw new Error('refusing to stage: no clean Defender scan report (migration-output/defender-scan.json). Run scan-quarantine.ps1 first.')
  const have = await existing()
  const todo = inventory.filter((r) => r.accepted && r.extracted && !r.oversize && have.get(r.path)?.status !== 'staged' && have.get(r.path)?.status !== 'linked')
  const products = todo.filter((r) => r.scope === 'product').sort((a, b) => a.size - b.size || a.path.localeCompare(b.path))
  const editors = todo.filter((r) => r.scope === 'editor' && ['png', 'jpeg', 'webp'].includes(r.detected_type) && r.size >= 20_000)
    .sort((a, b) => a.path.localeCompare(b.path)).slice(0, editorLimit)

  const groups = new Map()
  for (const r of [...products, ...editors]) groups.set(r.sha256, [...(groups.get(r.sha256) ?? []), r])
  // include every legacy path of a chosen blob (even paths outside the slice) so duplicate rows stay consistent
  for (const [sha, list] of groups) for (const r of inventory) if (r.sha256 === sha && r.accepted && r.extracted && !list.includes(r)) list.push(r)

  const report = { batch_id: batchId, dry_run: dry, uploaded: [], already_present: [], failed: [], skipped_over_limit: 0, bytes: 0 }
  let files = 0
  for (const [sha, list] of groups) {
    list.sort((a, b) => a.path.localeCompare(b.path))
    const head = list[0]
    if (report.bytes + head.size > limitBytes || files >= limitFiles) { report.skipped_over_limit++; continue }
    const type = head.detected_type
    const objectPath = objectPathFor(sha, EXT_FOR_TYPE[type])
    try {
      const local = path.join(root, ...head.path.split('/'))
      const buf = await readFile(local)
      const actual = createHash('sha256').update(buf).digest('hex')
      if (actual !== sha || buf.length !== head.size) throw new Error('quarantined copy does not match the inventory hash/size')
      if (!dry) {
        const { error } = await db.storage.from(BUCKET).upload(objectPath, buf, { contentType: head.mime_type, upsert: false })
        if (error && !/exists|Duplicate/i.test(error.message)) throw error;
        (error ? report.already_present : report.uploaded).push(objectPath)
      }
      report.bytes += head.size
      files++
      if (!dry) {
        const rows = await db.from('legacy_media_staging').select('id,legacy_path').in('legacy_path', list.map((r) => r.path))
        const canonical = rows.data.find((r) => r.legacy_path === head.path)
        for (const r of rows.data) {
          const { error } = await db.from('legacy_media_staging').update({
            status: 'staged', storage_path: objectPath, batch_id: batchId, scanned_at: av.finished_at, av_result: 'clean',
            duplicate_of: r.id === canonical.id ? null : canonical.id, reason: null, updated_at: new Date().toISOString(),
          }).eq('id', r.id)
          if (error) throw error
        }
      }
      if (files % 25 === 0) console.log(`… staged ${files} blobs, ${(report.bytes / 1e6).toFixed(1)} MB`)
    } catch (e) { report.failed.push({ path: head.path, error: String(e.message ?? e) }) }
  }
  return report
}

// ---- 3. verification against the live local Storage ------------------------------------------------------------
async function verify() {
  const rows = []
  for (let from = 0; ; from += 1000) { // PostgREST max_rows = 1000
    const { data, error } = await db.from('legacy_media_staging').select('legacy_path,sha256,byte_size,storage_path,status').eq('status', 'staged').order('id').range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) break
  }
  const byObject = new Map(rows.map((r) => [r.storage_path, r]))
  const result = { objects: byObject.size, rows: rows.length, size_ok: 0, hash_ok: 0, problems: [], public_read_blocked: null, anon_read_blocked: null }
  for (const [objectPath, r] of byObject) {
    const { data, error: e } = await db.storage.from(BUCKET).download(objectPath)
    if (e) { result.problems.push({ objectPath, problem: `download failed: ${e.message}` }); continue }
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.length === r.byte_size) result.size_ok++; else result.problems.push({ objectPath, problem: 'size mismatch' })
    if (createHash('sha256').update(buf).digest('hex') === r.sha256) result.hash_ok++; else result.problems.push({ objectPath, problem: 'hash mismatch' })
  }
  const sample = [...byObject.keys()][0]
  if (sample) {
    const pub = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${sample}`)
    result.public_read_blocked = pub.status >= 400
    const anon = await fetch(`${url}/storage/v1/object/${BUCKET}/${sample}`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })
    result.anon_read_blocked = anon.status >= 400
  }
  return result
}

let out
if (flag('--verify')) out = { verify: await verify() }
else {
  const registered = await register()
  out = { registered, stage: flag('--register-only') ? null : await stage() }
}
const dir = await readdir(OUT_DIR).catch(() => [])
void dir; void stat
await writeFile(path.join(OUT_DIR, `${flag('--verify') ? 'verify' : 'stage'}-${batchId}.json`), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, (k, v) => (Array.isArray(v) && v.length > 5 ? `[${v.length} items]` : v), 2))
