// Copies the licensed legacy assets that are NOT stored in this public repository (Janna LT fonts, Webmin admin.css)
// from the recovered, verified ui-reference/ directory next to this project. Local development only.
//   node scripts/dev/sync-legacy-assets.mjs [path-to-ui-reference]
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ref = resolve(process.argv[2] ?? join(root, '..', 'ui-reference'))
if (!existsSync(join(ref, 'assets', 'css', 'front.css'))) {
  console.error(`ui-reference not found at ${ref}. Pass its path as the first argument.`)
  process.exit(1)
}
const pairs = [
  ['assets/css/plugins/janna-lt-regular.ttf', 'public/assets/css/plugins/janna-lt-regular.ttf'],
  ['assets/css/plugins/janna-lt-bold.ttf', 'public/assets/css/plugins/janna-lt-bold.ttf'],
  ['assets/css/plugins/janna-lt-bold.ttf', 'public/assets/css/plugins/janna-bold.ttf'], // legacy CSS references this name (file absent in the recovered tree)
  ['assets/css/admin.css', 'public/assets/css/admin.css'],
]
for (const [from, to] of pairs) {
  mkdirSync(dirname(join(root, to)), { recursive: true })
  copyFileSync(join(ref, from), join(root, to))
  console.log('copied', to)
}
