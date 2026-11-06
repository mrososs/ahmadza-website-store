# VPS storage integration plan

**Status (2026-11-06):** the contract below is implemented **locally and tested** — `VpsStorageAdapter` (`server/services/storage/adapters.ts`), the HMAC module (`vpsSignature.ts`), the private media service (`services/media-server/server.mjs`) and the admin-upload path (VPS preferred when `vps` is enabled). It is **not deployed anywhere**, and nothing here connects to the Hostinger VPS. Deployment is gated: `VPS_SECURITY_GATE.md` (verdict: NO-GO on the legacy host until its read-only inspection clears it; GO for a new clean host). The sections below remain the contract; §9 items 1–2 (adapter, config) and the signature/entitlement tests are done, the bulk loader (`stage-media.mjs` VPS target), observability and host deployment are not.
Principle: **metadata and entitlements stay in Supabase; bytes live on the VPS; Nuxt server code decides who may fetch what.**

## 1. What already exists (ready for the VPS)
| Piece | Where | State |
|---|---|---|
| Media metadata model | `book_media`: `storage_provider` (`none/supabase/vps/external`), `storage_path` (= provider-relative **object key**), `migration_status` (`pending/staged/available/missing/rejected`), `sha256`, `byte_size`, `mime_type`, `legacy_path`, `legacy_book_media_id`, `checksum_verified_at`, `visibility` (`preview/after_purchase`), `external_url` | migration `20261115000000`, constraints + tests (`tests/api/media-storage.test.ts`) |
| Entitlements | `entitlements` (only `fulfill_payment()` writes) | tested |
| Delivery interface | `server/services/storage` — `MediaStorageAdapter.deliver(media, {ttlSeconds, downloadName}) → {kind:'redirect', url}`; adapters: `SupabaseStorageAdapter` (dev), `ExternalLinkAdapter` (https only), **`VpsStorageAdapter` (contract stub: throws `not_implemented`)** | in code |
| Authorisation | `GET /api/library/download/:mediaId`: published + (preview ‖ free ‖ entitlement ‖ admin) decided **before** an adapter is called | tested (401/403/302) |
| Safe failure | non-`available` media → 503 `{reason}`; disabled provider → 503; non-https external → 404; never a fake URL, never a public path | tested |
| UI states | book page shows "قيد التجهيز" for non-available media; admin file upload returns 503 when no storage backend is enabled | in code |
| Environment switch | `NUXT_MEDIA_ENABLED_PROVIDERS` (hosted default `external`; the preflight fails if hosted enables `supabase`) | in code |
| Staging inventory | `legacy_media_staging` (sha256, detected type, status) + `UNMAPPED_MEDIA` report; verified copy of the recovered files in quarantine on the dev machine | `07-historical-data-import.md` |

## 2. Required storage contract (VPS side)
A small private service (suggested: a Node/Go HTTP service behind HTTPS on the VPS, or Nginx with `secure_link`) offering:

| Operation | Called by | Contract |
|---|---|---|
| `PUT /objects/{key}` | Nuxt admin/import server code only | body = bytes; header `X-Content-SHA256`; service recomputes the hash, enforces size/type allow-list (PDF `%PDF`, MP3/M4A/OGG/WAV by magic bytes), writes atomically (temp file + rename), **refuses overwrite** of an existing key, returns `{key, sha256, bytes}` |
| `HEAD /objects/{key}` | Nuxt server | existence + size + stored sha256 |
| `GET /objects/{key}?exp=<unix>&sig=<hmac>&dn=<name>` | the **customer's browser**, following the 302 | valid only if `hmac(secret, key|exp|dn|method)` matches and `exp` is within ~120 s; `Content-Disposition: attachment`; no directory listing; no range of other keys |
| `DELETE /objects/{key}` | admin server code | soft-delete (move to `trash/`) |

* The HMAC secret is a server-only value shared between Nuxt and the VPS service (`NUXT_VPS_STORAGE_SIGNING_SECRET`); rotate by accepting two secrets during rollover.
* Nuxt **never** accepts a path or key from the browser: the key comes from `book_media.storage_path` after the authorisation check.
* The VPS service is reachable for uploads only from the Nuxt server (IP allow-list / mTLS / private token); downloads are public-but-signed.

## 3. Suggested private file layout
```
/srv/aawraq-media/                     (outside every web root; not served by Nginx directly)
  objects/<aa>/<sha256>.<ext>          content-addressed bytes (deduplicates the 1 039 unique blobs / 1 060 files)
  trash/<yyyymmdd>/…                   soft-deleted
  tmp/                                 atomic upload staging
```
`book_media.storage_path` holds the **object key** `sha256/<aa>/<hash>.<ext>` (same key scheme the local staging already uses under `legacy-staging`), so several `book_media` rows may share one object. Per-book keys (`books/<book_id>/<uuid>.pdf`) remain valid for newly uploaded files.

## 4. Authorisation flow (unchanged business rules)
1. Browser → `GET /api/library/download/:mediaId` (cookie session).
2. Nitro loads the `book_media` row (service role), checks book is published, then: preview ‖ free ‖ active entitlement ‖ admin. Else 401/403.
3. `createMediaStorage(event).deliver(...)`: requires `migration_status='available'` and the provider enabled; the **VPS adapter** builds a signed URL (`exp = now + signedUrlTtlSeconds`) and returns it.
4. Nitro answers `302 Location: <signed VPS URL>`; counts the download; logs `(user, media, ip-hash)`.
5. Browser fetches the bytes from the VPS within the TTL. Expired or tampered links return 403 from the VPS.

## 5. Upload & import API requirements
* **Admin upload** (`POST /api/admin/books/:id/media`): already validates magic bytes/size and computes sha256; the VPS phase swaps the `private-products` upload for `VpsStorageAdapter.put()` and sets `storage_provider='vps'`, `migration_status='available'` only after `HEAD` confirms the hash.
* **Bulk historical load** (`scripts/migration/stage-media.mjs`, a VPS target to be added): reads the verified quarantine copy, uploads each unique sha256 once (resumable, idempotent via `HEAD`), records `migration_status='staged'` → after book mapping exists `link-media.mjs` creates/updates `book_media` rows (`legacy_path` match, no re-upload) and flips to `available`.
* Never upload files the antivirus/magic-byte classifier rejected (90 files incl. all hostile payloads); the quarantine manifest is the allow-list.

## 6. Data mapping
| Legacy | New |
|---|---|
| `book_media.file` (`product_media/<site>-<ts>.pdf`) | `book_media.legacy_path` (+ staging row by sha256) |
| `book_media.id` | `legacy_book_media_id` |
| `is_free` 0/2 → preview, 1 → after_purchase | `visibility` |
| `external=1` + URL | `storage_provider='external'`, `external_url` (https only; rotted links reported) |
| physical file | `storage_provider='vps'`, `storage_path` = object key, `sha256`, `byte_size`, `mime_type` |
| file absent | `migration_status='missing'` + entry in the missing-media report |

## 7. Backup strategy
* Nightly encrypted snapshot of `/srv/aawraq-media/objects` to a second location (provider object storage or second VPS) with retention ≥ 30 days; weekly restore test.
* The sha256 in `book_media` is the integrity oracle: a scheduled job re-hashes a rotating sample and reports mismatches.
* Supabase database backups (PITR/daily) cover the metadata; both must be restorable together (objects are immutable and content-addressed, so a DB point-in-time restore never references a missing newer object).

## 8. Security requirements
HTTPS only, HSTS; no directory listing; objects outside any web root; unique unguessable keys + signature; short TTL; `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`; rate limit per IP; upload endpoint not publicly routable; no execution permissions on the media tree (`noexec`); AV scan (ClamAV) on upload; logs without signatures; secret rotation procedure; firewall allow-list for the upload port.

## 9. Integration points to implement next
1. `VpsStorageAdapter.deliver()` (+ `put/head/delete`), runtime config `vpsStorageBaseUrl`, `vpsStorageSigningSecret` (server-only).
2. Enable `vps` in `NUXT_MEDIA_ENABLED_PROVIDERS` for hosted.
3. Admin upload + importer targets; mapping job once the SQL dump exists.
4. Tests: signature expiry/tamper, entitlement matrix against the VPS adapter, hash-mismatch refusal, replay of expired URL.
5. Observability: download log table or file-based audit.

## 10. Outstanding decisions
Protection level of paid PDFs (parity = full original with signed expiring link vs per-buyer watermark vs stream-only viewer) · retention of download logs · whether `preview` files are served by the same service or a public CDN path · VPS capacity/bandwidth (6.4 GiB recovered + growth) · second-site backup provider · whether to keep Supabase Storage for small public images only (current design: yes — `public-media` covers/images; `private-sensitive` contributor documents).
