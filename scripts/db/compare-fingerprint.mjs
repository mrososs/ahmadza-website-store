// Compare two fingerprint result files (local vs hosted). Accepts the JSON written by fingerprint.mjs, or the rows returned by an
// MCP/SQL-runner execution of schema-fingerprint.sql saved as JSON ([{section,n,digest,entries?}, ...]).
//   node scripts/db/compare-fingerprint.mjs <local.json> <hosted.json>
// Exit 0 only when every section digest matches. With `entries` on both sides it lists the exact differing objects.
import { readFileSync } from 'node:fs'

const [a, b] = process.argv.slice(2)
if (!a || !b) { console.error('usage: compare-fingerprint.mjs <local.json> <hosted.json>'); process.exit(2) }
const load = (f) => {
  let v = JSON.parse(readFileSync(f, 'utf8'))
  if (!Array.isArray(v) && Array.isArray(v?.rows)) v = v.rows
  return new Map(v.map((r) => [r.section, r]))
}
const L = load(a); const H = load(b)
let bad = 0
for (const section of [...new Set([...L.keys(), ...H.keys()])].sort()) {
  const l = L.get(section); const h = H.get(section)
  if (l && h && l.digest === h.digest) { console.log(`ok    ${section.padEnd(16)} n=${l.n}`); continue }
  bad++
  console.log(`DIFF  ${section.padEnd(16)} local n=${l?.n ?? '-'}  hosted n=${h?.n ?? '-'}`)
  if (l?.entries && h?.entries) {
    const keys = [...new Set([...Object.keys(l.entries), ...Object.keys(h.entries)])].sort()
    for (const k of keys) {
      if (!(k in h.entries)) console.log(`        only local : ${k}`)
      else if (!(k in l.entries)) console.log(`        only hosted: ${k}`)
      else if (JSON.stringify(l.entries[k]) !== JSON.stringify(h.entries[k])) console.log(`        differs    : ${k}\n          local : ${JSON.stringify(l.entries[k]).slice(0, 200)}\n          hosted: ${JSON.stringify(h.entries[k]).slice(0, 200)}`)
    }
  }
}
console.log(bad ? `\n${bad} section(s) differ` : '\nschemas match')
process.exit(bad ? 1 : 0)
