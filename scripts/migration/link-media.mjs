// Link staged media to books once the legacy book_media -> file mapping is known (i.e. after the DB import).
//   node scripts/migration/link-media.mjs --mapping mapping.json [--dry-run]
// mapping.json: [{ "legacy_path": "storage/app/public/product_media/<file>", "book_id": 12, "visibility": "after_purchase", ... }]
// No bytes are uploaded again (server-side copy inside local Storage); identical blobs stay de-duplicated in staging.
import { readFile } from 'node:fs/promises'
import { serviceClient } from './lib/supabase.mjs'
import { linkMedia } from './lib/link.mjs'

const args = process.argv.slice(2)
const file = args[args.indexOf('--mapping') + 1]
if (!args.includes('--mapping') || !file) { console.error('usage: link-media.mjs --mapping <file.json> [--dry-run]'); process.exit(2) }
const mappings = JSON.parse(await readFile(file, 'utf8'))
const { db } = serviceClient()
const report = await linkMedia(db, mappings, { dryRun: args.includes('--dry-run') })
console.log(JSON.stringify({ linked: report.linked.length, skipped: report.skipped, failed: report.failed }, null, 2))
if (report.failed.length) process.exit(1)
