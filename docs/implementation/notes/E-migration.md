# Fork E — historical data & media migration pipeline

## Built (all under `scripts/migration/`, `tests/`, `docs/`)
- `data-availability.mjs`, `lib/paths.mjs` — dump search (workspace + both member lists) and streamed SHA-256 verification of both archives.
- `lib/tar.mjs` (read-only tar reader), `lib/classify.mjs` (magic-byte classifier, marker scanner, path hygiene), `media-inventory.mjs` (inventory + selective quarantine extraction, V6 manifest diff, UNMAPPED_MEDIA/rejected/duplicate reports).
- `scan-quarantine.ps1` (Windows Defender gate), `stage-media.mjs` (bounded, resumable, content-addressed staging into the private `legacy-staging` bucket; `--verify`), `lib/link.mjs` + `link-media.mjs` (link staged objects to `book_media` without re-uploading).
- `import-legacy.mjs`, `lib/{transform,importer,source,money,sanitize}.mjs` (MariaDB importer, preflight refusal, dry-run, reconciliation skeleton), `reconcile.mjs` (generated report).
- Migration `20261111000000_legacy_staging_support.sql`: `legacy-staging` bucket MIME allow-list extended (images, mp4) and `scope/mime_type/scanned_at/av_result` columns on `legacy_media_staging`. Applied with `migration up --include-all` (other forks' later-numbered migrations were already applied). Types regenerated.
- npm scripts `migrate:*` added to `package.json`.
- Tests (52 passing): `tests/unit/migration-{money-transform,classify-tar,importer}.test.ts`, `tests/db/{staging,migration-import}.test.ts`, fixtures in `tests/fixtures/legacy-mock.mjs` (MOCK, ids 900001+).

## Business-rule / migration coverage (docs/legacy-audit/14)
| Item | Implementation | Test |
|---|---|---|
| Money history verbatim, raw kept (V4/V8) | `lib/money.mjs`, `mapBook/mapOrder/mapOrderItem/mapAffiliateOrder/mapWithdraw` | migration-money-transform |
| No passwords / default_password / tokens (V3) | `mapUser`, `ensureAuthUser` (no password) | migration-money-transform |
| is_free 0/2→preview, 1→after_purchase | `mapMediaVisibility` | migration-money-transform |
| Category/tag JSON → links, invalid JSON never guessed | `mapBook`, loader | migration-money-transform, migration-import (DB) |
| M1/M2 media: hash-keyed, shared objects, magic bytes | `media-inventory`, `stage-media`, `link.mjs` | staging (DB), classify-tar |
| M6 hostile exclusions | `classify.mjs` | classify-tar |
| Idempotency via legacy ids / legacy_id_map | `importer.mjs` upserts | migration-import (DB) |
| Dry-run writes nothing | `runImport({dryRun})` | migration-importer |
| Sensitive data opt-in | `preflight` + CLI | migration-importer |

## Findings / notes for the lead
- No dump anywhere: importer cannot run on real data; it refuses with an exact missing-input list.
- Defender quarantined a first draft of `tests/unit/migration-classify-tar.test.ts` (literal web-shell strings). Rewritten to build patterns at runtime; the scanner itself was not touched. Other forks should avoid literal exploit strings in committed test files.
- `h3` vs PostgREST: PostgREST caps responses at 1000 rows (`max_rows`); every script that reads the staging table paginates. Bulk `upsert` needs `defaultToNull: false` or missing keys become NULL.
- Disk: C: free ≈ 8.2 GiB (was 17.5 GiB early in the session, before Docker pulls/other work). Do not stage the remaining ~6 GB of PDFs into local Storage without freeing space or moving the Docker data root to D:.
- Quarantine copy (1,173 files, 6.96 GB) is in `D:\mostqel\aawraq-quarantine\user-files\` — outside the repo, never served.
- Untested against a DB: the customer/financial loaders (orders are append-only so they can't be exercised on the shared dev DB). Dry-run unit tests only.
