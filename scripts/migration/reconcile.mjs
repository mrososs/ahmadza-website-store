// Honest data-availability + counts report (what exists, what is missing, what is staged).
//   node scripts/migration/reconcile.mjs      -> docs/implementation/data-availability-report.md (+ migration-output/reconciliation.json)
// Inputs: migration-output/{data-availability,inventory-summary,defender-scan}.json and the local staging table.
import { readFile, writeFile, mkdir, statfs } from 'node:fs/promises'
import path from 'node:path'
import { OUT_DIR, ROOT, QUARANTINE } from './lib/paths.mjs'
import { serviceClient } from './lib/supabase.mjs'

const j = async (f) => JSON.parse((await readFile(path.join(OUT_DIR, f), 'utf8').catch(() => 'null')).replace(/^\uFEFF/, ''))
const [avail, inv, av] = [await j('data-availability.json'), await j('inventory-summary.json'), await j('defender-scan.json')]
const { db } = serviceClient()

// PostgREST caps responses at max_rows (1000): page through the table
const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('legacy_media_staging').select('status,scope,byte_size,storage_path,duplicate_of').order('id').range(from, from + 999)
  if (error) throw error
  rows.push(...data)
  if (data.length < 1000) break
}
const by = {}
for (const r of rows) { const k = `${r.status}/${r.scope ?? '-'}`; by[k] ??= { rows: 0, bytes: 0, objects: new Set() }; by[k].rows++; by[k].bytes += r.byte_size; if (r.storage_path) by[k].objects.add(r.storage_path) }
const { data: runs } = await db.from('migration_runs').select('id,kind,finished_at,counts').order('id', { ascending: false }).limit(5)
const { data: bookCount } = await db.from('books').select('id', { count: 'exact', head: true }).eq('is_demo', false)
const free = async (p) => { const s = await statfs(p); return Number(s.bavail * s.bsize) }
const gb = (n) => (n / 2 ** 30).toFixed(2)
const mb = (n) => (n / 2 ** 20).toFixed(1)

const lines = [
  '# Data availability & reconciliation report (generated)', '',
  `Generated ${new Date().toISOString()} by \`scripts/migration/reconcile.mjs\`. Numbers come from the recovered archives and the LOCAL database — nothing is estimated.`, '',
  '## 1. Is there a production database?', '',
  `**${avail?.verdict ?? 'unknown (run data-availability.mjs)'}**`, '',
  '| Archive | Bytes | Entries | SHA-256 matches audit evidence | Dump-like members |', '|---|---:|---:|---|---:|',
  ...Object.entries(avail?.archives ?? {}).map(([n, a]) => `| \`${n}\` | ${a.bytes.toLocaleString()} | ${a.entries} | ${a.sha256_match ? 'yes' : 'NO'} | ${a.dump_like_members.length} |`), '',
  `Workspace dump candidates (outside \`new-platform/\`): ${avail?.workspace_dump_candidates?.length ?? '?'}. Consequence: **no customers, orders, payments, commissions, prices, titles or categories can be imported.** Non-demo books in the local DB: ${bookCount === null ? 0 : 'see query'}.`, '',
  '## 2. Media inventory (V6)', '',
  `- Archive members: ${inv?.files} files + ${inv?.directories} directories. Accepted ${inv?.accepted}, rejected ${inv?.rejected}.`,
  `- Product media (storage/app/public/product_media): **${inv?.product_pdf_or_audio}** files (${inv?.unique_product_blobs} unique blobs, ${gb(inv?.product_bytes)} GiB). All **UNMAPPED_MEDIA** — the DB link \`book_media.file\` is missing.`,
  `- Accepted by detected type: ${Object.entries(inv?.accepted_by_type ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
  `- Manifest comparison (docs/legacy-audit/evidence/media-manifest.csv): ${inv?.manifest?.entries} entries, ${inv?.manifest?.missing_from_archive} missing, ${inv?.manifest?.not_in_manifest} unexpected, ${inv?.manifest?.mismatches} hash/size mismatches.`,
  `- Duplicate groups (SHA-256, accepted files): ${inv?.duplicate_groups}. Oversize (>100 MiB): ${inv?.oversize_files?.length ?? 0}.`, '',
  '### Rejected members (never extracted, never uploaded)', '', '| Reason | Count |', '|---|---:|',
  ...Object.entries(inv?.rejected_by_reason ?? {}).map(([k, v]) => `| ${k} | ${v} |`), '',
  '## 3. Antivirus gate', '',
  av ? `Windows Defender custom scan of \`${av.path}\`: **${av.clean ? 'clean' : 'NOT CLEAN / incomplete'}**; ${av.detections?.length ?? 0} detections; ${av.files_present_after_scan} files still present after the scan; signatures ${av.signature_version} (${av.signatures_updated}); real-time protection ${av.realtime_protection ? 'on' : 'off'}.` : 'no scan report',
  '', '## 4. Local staging (private bucket `legacy-staging`)', '', '| status/scope | rows | unique objects | bytes of rows |', '|---|---:|---:|---:|',
  ...Object.entries(by).map(([k, v]) => `| ${k} | ${v.rows} | ${v.objects.size} | ${mb(v.bytes)} MB |`), '',
  `Latest migration runs: ${(runs ?? []).map((r) => `#${r.id} (${r.kind.slice(0, 40)})`).join(', ') || 'none'}.`, '',
  '## 5. Disk', '', `- C: free (hosts the Docker/Supabase volumes): ${gb(await free('C:\\'))} GiB`, `- D: free (hosts quarantine ${QUARANTINE}): ${gb(await free('D:\\'))} GiB`, '',
]
const out = lines.join('\n')
await mkdir(path.join(ROOT, 'docs/implementation'), { recursive: true })
await writeFile(path.join(ROOT, 'docs/implementation/data-availability-report.md'), out)
await writeFile(path.join(OUT_DIR, 'reconciliation.json'), JSON.stringify({ avail: avail?.verdict, inventory: inv, staging: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { rows: v.rows, objects: v.objects.size, bytes: v.bytes }])) }, null, 2))
console.log(out)
