// Generates docs/implementation/MIGRATION_INVENTORY.md from supabase/migrations (names + SHA-256).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = new URL('../../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const purpose = {
  '20261106100000': 'Extensions, enums, `normalize_ar`, `site_settings`, `profiles`, `user_roles`, `is_admin()`, auth→profile trigger, `audit_log`',
  '20261106100100': 'Catalog & CMS: categories, makers, books (+links, tags, relations), book_media, articles, pages, comments, favourites, contact_messages, `purge_demo_data`',
  '20261106100200': 'Commerce & money: payments, payment_events, orders/items (immutable), entitlements, affiliate commissions/ledger (append-only), withdrawals, payout methods, contributor requests, legacy bookkeeping, trusted SQL functions',
  '20261106100300': 'RLS on every table, explicit grants, column-level grants, storage buckets, `site_totals()`',
  '20261107000000': '`book_comments()` public listing with author names',
  '20261108000000': '`increment_media_download()` download counter (service_role only)',
  '20261109000000': 'Admin server-only helpers (e.g. `admin_list_users`, counts); all SECURITY DEFINER and service_role only',
  '20261110000000': 'Affiliate & contributor support: `payout_methods.is_active`, admin overview functions (service_role only)',
  '20261110000100': 'Grant `affiliate_balance()` to service_role (bug found by tests)',
  '20261110000200': 'Ledger visibility fix (concurrent withdrawals cannot both pass; `clock_timestamp()`)',
  '20261111000000': 'Private `legacy-staging` bucket mime list/limits for the recovered-media staging pipeline (no Data API policy)',
  '20261112000000': 'Fix: policies must not sub-select non-granted columns (superseded by 20261114 for the helper location)',
  '20261113000000': '`purge_demo_data()` archives purchased demo books instead of failing',
  '20261114000000': 'Hardening: `private` schema helper, merged policies, initplan `is_admin()`, anon execute revoked on helpers, 22 FK indexes',
  '20261115000000': 'Media storage readiness: `storage_provider`, `migration_status`, normalising trigger, provider/key constraints, checksum/size checks',
}
const rows = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => {
  const v = f.split('_')[0]
  const sha = createHash('sha256').update(readFileSync(join(dir, f), 'utf8')).digest('hex').slice(0, 12)
  return `| \`${v}\` | \`${f}\` | ${purpose[v] ?? '—'} | \`${sha}…\` | local ✔ | not applied |`
})
writeFileSync(new URL('../../docs/implementation/MIGRATION_INVENTORY.md', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
`# Migration inventory

Source of truth: \`supabase/migrations/*.sql\` (${rows.length} files, strictly ordered, replayed from scratch with \`supabase db reset\`; each also applied incrementally with \`migration up\`).
Regenerate with \`node scripts/db/gen-inventory-doc.mjs\`. Machine-readable checksums: \`migration-inventory.json\` (\`npm run hosted:preflight -- --write-inventory\`).

**Hosted status: nothing applied** — no authorised access to \`ubjuyeccioflhpcpnhmo\` in this session (see \`HOSTED_SUPABASE_SETUP.md\`).
All migrations are additive and idempotent where re-run is plausible (\`create or replace\`, \`if not exists\`, \`drop policy if exists\`). None drops a table, schema or column.
\`seed.sql\` (synthetic demo catalog, \`is_demo=true\`) is **local-only** and is never applied to the hosted project.

| Version | File | Purpose | SHA-256 (first 12) | Local | Hosted |
|---|---|---|---|---|---|
${rows.join('\n')}
`)
console.log('written', rows.length)
