# 03 — Supabase schema (local PostgreSQL)

Source of truth: `supabase/migrations/*.sql` (applied by `npx supabase db reset`; reproducible, local only).
Design baseline: `docs/legacy-audit/13-nuxt-supabase-architecture.md` §4 and `14-data-migration-mapping.md`. Where this
implementation deviates from that draft, the deviation is listed in §6.

## 1. Migration order

| Migration | Content |
|---|---|
| `20261106100000_foundation_identity` | extensions (`pg_trgm`), enums, `normalize_ar()`, `site_settings` singleton, `profiles`, `user_roles`, `is_admin()`, auth→profile trigger, `audit_log` + generic audit trigger |
| `20261106100100_catalog_content` | `categories`, `makers`, `books`, `book_categories`, `book_makers`, `book_tags`, `book_relations`, `book_media`, `articles`, `pages`, `comments`, `favourites`, `contact_messages`, `purge_demo_data()` |
| `20261106100200_commerce_affiliate` | `payments`, `payment_events`, `orders`, `order_items`, `entitlements`, `affiliate_commissions`, `affiliate_ledger`, `withdrawal_requests`, `payout_methods`, `contributor_requests`, legacy-import bookkeeping tables, and the trusted SQL functions (`create_payment_for_cart`, `fulfill_payment`, `register_payment_event`, `fail_payment`, `affiliate_balance`, `request_withdrawal`, `decide_withdrawal`, `approve/decline_contributor_request`, `increment_view`) |
| `20261106100300_rls_grants` | RLS on **every** table, explicit grants, column-level grants, storage buckets, `site_totals()` |
| `20261112000000_fix_public_book_policies` | `is_public_book()` (policies must not sub-select non-granted columns — bug found by `tests/db/rls.test.ts`) |
| `2026110[7-11]…` | slice migrations (storefront, commerce, admin, affiliate/contributor, import) — listed in the slice notes under `docs/implementation/notes/` |

## 2. Entity overview

```
auth.users ─1:1─ profiles ─┬─< orders ─< order_items >─ books ─< book_media
                           │      └─1:1─ payments            ├─< book_categories >─ categories
                           ├─< entitlements >─ books          ├─< book_makers >─ makers
                           ├─< affiliate_commissions          ├─< book_tags
                           ├─< affiliate_ledger (append-only) └─< book_relations
                           ├─< withdrawal_requests, payout_methods
                           ├─< contributor_requests ──> books (draft on approval)
                           ├─< comments, favourites, contact_messages
                           └─< user_roles (admin)
site_settings (1 row)   audit_log   legacy_id_map / migration_runs / migration_rejects / legacy_media_staging
```

## 3. Modelling decisions (and the legacy problem each one fixes)

| Legacy problem (`docs/legacy-audit/08`, `12`) | Implementation |
|---|---|
| Money in `varchar`, float arithmetic | `numeric(12,2)` everywhere + `currency char(3)`; `legacy_raw_*` text columns preserve imported originals |
| Magic-integer enums (`status 0/1/2`, `is_free 0/1/2`) | PostgreSQL enums: `content_status`, `book_kind`, `media_visibility` (legacy `is_free` 0 and 2 → `preview`, 1 → `after_purchase`), `account_status`, … |
| JSON arrays in `varchar` (`books.category`, `tags`, makers) | link tables `book_categories`, `book_makers`, `book_tags` |
| `ON DELETE CASCADE` could erase purchase history | transactional FKs are `ON DELETE RESTRICT` (orders, order_items, payments, ledger); catalog uses soft delete (`deleted_at`) |
| Mutable string balance (`users.balance`) | **append-only** `affiliate_ledger` (signed amounts, `available_at` freeze); balances derived by `affiliate_balance()`; update/delete blocked by trigger |
| Orders writable after the fact | `orders_immutable` / `order_items_immutable` triggers: delete refused, financial columns immutable |
| Order created from browser callback *or* webhook with lost affiliate attribution | `payments` is created first (affiliate captured server-side at checkout); `fulfill_payment()` is the **only** creator of orders / entitlements / commissions and is idempotent (`FOR UPDATE` lock + `payments.order_id` + unique `provider_transaction_id`) |
| Test-mode orders granted access and commissions | `payments.mode`, `entitlements.is_test`, `affiliate_commissions.is_test`; test payments are refused unless `site_settings.allow_test_payments` (false by default; true only in the local seed); `dev_simulator` provider is constrained to `mode='test'` |
| Plaintext `default_password`, copied hashes | not modelled: Supabase Auth owns credentials; `profiles.require_password_reset` flags migrated accounts |
| Public capability URL for IBAN/Ministry documents | `contributor_requests.*_path` point into the private `private-sensitive` bucket |
| Settings stored as strings, unknown live values | `site_settings` typed columns; legacy *defaults* (10 %, 30 days, 100) are stored but listed in `pending_owner_confirmation` until the owner confirms |
| Search `LIKE %q%` on raw text | `title_norm` (trigger-maintained `normalize_ar(title)`) + `pg_trgm` GIN index; same normalisation in `shared/utils/arabic.ts` |

## 4. Public IDs and legacy identifiers

Public entities use `bigint identity` ids so the legacy URL shape `/book/{id}/{slug}` survives. Every migrated row will carry
`legacy_id` (unique) plus entries in `legacy_id_map(entity, legacy_id, new_id)`; `legacy_*_raw` columns keep original strings.
Decoding legacy Hashids/encrypted tokens needs the original salt/`APP_KEY` (not recovered — see 10-remaining-blockers).

## 5. Storage buckets

| Bucket | Public | Limit | Types | Policies |
|---|---|---|---|---|
| `public-media` | yes | 10 MiB | png/jpeg/webp/gif | `select` for anon/authenticated; writes server-side only |
| `private-products` | no | 100 MiB | pdf, mp3/mp4/ogg/wav | **none** — reachable only through server-issued short-lived signed URLs after an entitlement check |
| `private-sensitive` | no | 25 MiB | pdf, images | **none** — contributor/withdrawal documents, owner/admin via signed URL |
| `legacy-staging` | no | 100 MiB | pdf, mp3 | **none** — quarantined historical media awaiting book mapping |

## 6. Deviations from the draft in `13`

* No `carts`/`cart_items` tables: cart = ids in the browser (Pinia + `localStorage`), priced by the server at quote/checkout time (decision D7).
* `entitlements` can be revoked (`revoked_at`) but the UI for revocation is not built.
* `payout_methods.details` is protected by RLS only; field-level encryption (Supabase Vault/KMS) is an open item.
* Admin MFA is modelled (`site_settings.require_admin_mfa` → `is_admin()` requires `aal2`) but defaults to off locally; TOTP is enabled in `supabase/config.toml`.
