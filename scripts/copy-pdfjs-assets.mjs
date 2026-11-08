// Self-host the PDF.js decoder assets (CMaps for Arabic/CJK fonts, standard fonts, WASM image decoders) under /_pdfjs/<version>/.
// The reader never loads them from a CDN. The folder is generated from the pinned dependency and is not committed.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = path.join(root, 'node_modules', 'pdfjs-dist')
if (!existsSync(pkgDir)) { console.warn('pdfjs-dist is not installed; skipping asset copy'); process.exit(0) }
const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
const out = path.join(root, 'public', '_pdfjs')
rmSync(out, { recursive: true, force: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  if (!existsSync(path.join(pkgDir, dir))) continue
  mkdirSync(path.join(out, version), { recursive: true })
  cpSync(path.join(pkgDir, dir), path.join(out, version, dir), { recursive: true })
}
console.log(`pdfjs assets ${version} -> public/_pdfjs/${version}`)
