# Migration inventory

Source of truth: `supabase/migrations/*.sql` (15 files, strictly ordered, replayed from scratch with `supabase db reset`; each also applied incrementally with `migration up`).
Regenerate with `node scripts/db/gen-inventory-doc.mjs`. Machine-readable checksums: `migration-inventory.json` (`npm run hosted:preflight -- --write-inventory`).

**Hosted status: nothing applied** — no authorised access to `ubjuyeccioflhpcpnhmo` in this session (see `HOSTED_SUPABASE_SETUP.md`).
All migrations are additive and idempotent where re-run is plausible (`create or replace`, `if not exists`, `drop policy if exists`). None drops a table, schema or column.
`seed.sql` (synthetic demo catalog, `is_demo=true`) is **local-only** and is never applied to the hosted project.

| Version | File | Purpose | SHA-256 (first 12) | Local | Hosted |
|---|---|---|---|---|---|
| `20261106100000` | `20261106100000_foundation_identity.sql` | Extensions, enums, `normalize_ar`, `site_settings`, `profiles`, `user_roles`, `is_admin()`, auth→profile trigger, `audit_log` | `75fd82fe9098…` | local ✔ | not applied |
| `20261106100100` | `20261106100100_catalog_content.sql` | Catalog & CMS: categories, makers, books (+links, tags, relations), book_media, articles, pages, comments, favourites, contact_messages, `purge_demo_data` | `790b526755c7…` | local ✔ | not applied |
| `20261106100200` | `20261106100200_commerce_affiliate.sql` | Commerce & money: payments, payment_events, orders/items (immutable), entitlements, affiliate commissions/ledger (append-only), withdrawals, payout methods, contributor requests, legacy bookkeeping, trusted SQL functions | `27127fe83ae0…` | local ✔ | not applied |
| `20261106100300` | `20261106100300_rls_grants.sql` | RLS on every table, explicit grants, column-level grants, storage buckets, `site_totals()` | `3ebd41bb0c4d…` | local ✔ | not applied |
| `20261107000000` | `20261107000000_storefront_comments.sql` | `book_comments()` public listing with author names | `e1a4883f3074…` | local ✔ | not applied |
| `20261108000000` | `20261108000000_commerce_helpers.sql` | `increment_media_download()` download counter (service_role only) | `39729ebf2ca1…` | local ✔ | not applied |
| `20261109000000` | `20261109000000_admin_support.sql` | Admin server-only helpers (e.g. `admin_list_users`, counts); all SECURITY DEFINER and service_role only | `c71da767611a…` | local ✔ | not applied |
| `20261110000000` | `20261110000000_affiliate_contributor_support.sql` | Affiliate & contributor support: `payout_methods.is_active`, admin overview functions (service_role only) | `85cee781616c…` | local ✔ | not applied |
| `20261110000100` | `20261110000100_affiliate_balance_service_role.sql` | Grant `affiliate_balance()` to service_role (bug found by tests) | `fafa1a712a62…` | local ✔ | not applied |
| `20261110000200` | `20261110000200_ledger_visibility_fix.sql` | Ledger visibility fix (concurrent withdrawals cannot both pass; `clock_timestamp()`) | `955d3dc12bfe…` | local ✔ | not applied |
| `20261111000000` | `20261111000000_legacy_staging_support.sql` | Private `legacy-staging` bucket mime list/limits for the recovered-media staging pipeline (no Data API policy) | `9fe4c217b38d…` | local ✔ | not applied |
| `20261112000000` | `20261112000000_fix_public_book_policies.sql` | Fix: policies must not sub-select non-granted columns (superseded by 20261114 for the helper location) | `ec5fad928c8c…` | local ✔ | not applied |
| `20261113000000` | `20261113000000_purge_demo_safe.sql` | `purge_demo_data()` archives purchased demo books instead of failing | `a57fd21a7ff5…` | local ✔ | not applied |
| `20261114000000` | `20261114000000_security_performance_hardening.sql` | Hardening: `private` schema helper, merged policies, initplan `is_admin()`, anon execute revoked on helpers, 22 FK indexes | `ffc025be60a6…` | local ✔ | not applied |
| `20261115000000` | `20261115000000_media_storage_readiness.sql` | Media storage readiness: `storage_provider`, `migration_status`, normalising trigger, provider/key constraints, checksum/size checks | `feeaa50ee421…` | local ✔ | not applied |
