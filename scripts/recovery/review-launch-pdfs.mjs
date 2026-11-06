// Read-only review of the quarantined PDFs that carry a /Launch action.
//   node scripts/recovery/review-launch-pdfs.mjs [--quarantine <dir>] [--out <dir>] [--limit N]
// It reads bytes only: no file is opened by a viewer, executed, copied, renamed, staged or imported, and NO database is touched. A file that carries /Launch stays
// excluded whatever this reports: the output only groups the files by WHAT they would launch, so a person can decide whether a separate, recorded validation
// is worth starting (docs/implementation/SUSPICIOUS_PDF_POLICY.md). Reports: migration-output/launch-pdf-review.json (+ .md), git-ignored. Files are named by sha256 prefix.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OUT_DIR, QUARANTINE } from '../migration/lib/paths.mjs'
import { readJsonFile, safeJoin } from './lib/evidence-collect.mjs'
import { classifyTarget, scanFileForLaunch, verdictFor } from './lib/launch-targets.mjs'

const args = process.argv.slice(2)
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const root = opt('--quarantine', path.join(QUARANTINE, 'user-files'))
const out = opt('--out', OUT_DIR)
const limit = Number(opt('--limit', Infinity))

const inventory = await readJsonFile(path.join(OUT_DIR, 'inventory.json'))
const rows = inventory.filter((r) => r.scope === 'product' && r.detected_type === 'pdf' && r.accepted && r.extracted).slice(0, limit)

const results = []
const unreadable = []
let next = 0
const worker = async () => {
  while (next < rows.length) {
    const row = rows[next++]
    const full = safeJoin(root, row.path)
    const scan = full ? await scanFileForLaunch(full) : { ok: false, reason: 'unsafe_path' }
    if (!scan.ok) { unreadable.push({ id: row.sha256.slice(0, 12), reason: scan.reason }); continue }
    if (!scan.launch_keywords) continue
    const classes = [...new Set(scan.actions.map((a) => classifyTarget(a.target)))].sort()
    results.push({
      id: row.sha256.slice(0, 12), size: scan.size, launch_keywords: scan.launch_keywords, actions_read: scan.actions.length,
      verdict: verdictFor(scan.actions), classes,
      // the target text is attacker-controlled: kept short, in the git-ignored JSON only, never in the markdown
      targets: scan.actions.slice(0, 5).map((a) => ({ target: a.target?.slice(0, 120) ?? null, class: classifyTarget(a.target), params: a.has_params, directory: a.has_directory, platforms: a.platform_blocks })),
    })
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
results.sort((a, b) => a.id.localeCompare(b.id))

const count = (xs) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})
const summary = {
  generated_at: new Date().toISOString(),
  scanned_pdfs: rows.length,
  unreadable: unreadable.length,
  with_launch: results.length,
  by_verdict: count(results.map((r) => r.verdict)),
  by_class_combination: count(results.map((r) => r.classes.join('+') || 'none')),
  by_class_any: count(results.flatMap((r) => r.classes)),
  with_parameters: results.filter((r) => r.targets.some((t) => t.params)).length,
  executable_extensions: count(results.flatMap((r) => r.targets.filter((t) => t.class === 'executable_or_script').map((t) => /\.([A-Za-z0-9]{1,8})$/.exec(t.target ?? '')?.[1]?.toLowerCase() ?? '?'))),
  policy: 'Every file listed stays excluded. A verdict of "reviewable" means only that a person may look at it; it never admits a file.',
}
await mkdir(out, { recursive: true })
await writeFile(path.join(out, 'launch-pdf-review.json'), JSON.stringify({ summary, unreadable, files: results }, null, 1))

const table = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join('\n') || '| (none) | 0 |'
await writeFile(path.join(out, 'launch-pdf-review.md'), [
  '# PDFs with a /Launch action: what they would launch', '',
  `Generated ${summary.generated_at}. Static byte reading only; nothing was opened, executed, copied or imported. **Every file below remains excluded.**`, '',
  `- PDFs scanned: ${summary.scanned_pdfs} (unreadable: ${summary.unreadable})`,
  `- PDFs containing /Launch: ${summary.with_launch}`,
  `- with command-line parameters: ${summary.with_parameters}`, '',
  '## Verdict', '', '| verdict | files |', '|---|---|', table(summary.by_verdict), '',
  '`blocked`: at least one action could run code, reach outside its folder, or passes parameters. `reviewable`: every action names a plain document next to the file; it means a person MAY look, never that the file is approved. `inconclusive`: a Launch keyword with no readable action.', '',
  '## What the actions point at (a file can appear in several rows)', '', '| target class | files |', '|---|---|', table(summary.by_class_any), '',
  '## Executable or script extensions named', '', '| extension | files |', '|---|---|', table(summary.executable_extensions), '',
  'Per-file detail (by sha256 prefix) is in `launch-pdf-review.json`. Not examined: a /Launch inside a compressed object stream is invisible to a byte scan, which is why no verdict here can admit a file.', '',
].join('\n'))

console.log(JSON.stringify({ scanned: summary.scanned_pdfs, unreadable: summary.unreadable, with_launch: summary.with_launch, by_verdict: summary.by_verdict, by_class_any: summary.by_class_any, with_parameters: summary.with_parameters, executable_extensions: summary.executable_extensions }, null, 1))
