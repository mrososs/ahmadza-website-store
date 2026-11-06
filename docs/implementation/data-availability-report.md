# Data availability & reconciliation report (generated)

Generated 2026-11-06T12:38:20.329Z by `scripts/migration/reconcile.mjs`. Numbers come from the recovered archives and the LOCAL database — nothing is estimated.

## 1. Is there a production database?

**NO DATABASE DUMP AVAILABLE (workspace + both archive member lists)**

| Archive | Bytes | Entries | SHA-256 matches audit evidence | Dump-like members |
|---|---:|---:|---|---:|
| `aawraq-source.tar.gz` | 32,546,247 | 976 | yes | 0 |
| `aawraq-user-files.tar` | 6,985,523,200 | 1266 | yes | 0 |

Workspace dump candidates (outside `new-platform/`): 0. Consequence: **no customers, orders, payments, commissions, prices, titles or categories can be imported.** Non-demo books in the local DB: 0.

## 2. Media inventory (V6)

- Archive members: 1263 files + 3 directories. Accepted 1173, rejected 90.
- Product media (storage/app/public/product_media): **1060** files (1039 unique blobs, 6.39 GiB). All **UNMAPPED_MEDIA** — the DB link `book_media.file` is missing.
- Accepted by detected type: png=101, jpeg=8, mp4=4, pdf=1059, mp3=1.
- Manifest comparison (docs/legacy-audit/evidence/media-manifest.csv): 1263 entries, 0 missing, 0 unexpected, 0 hash/size mismatches.
- Duplicate groups (SHA-256, accepted files): 31. Oversize (>100 MiB): 0.

### Rejected members (never extracted, never uploaded)

| Reason | Count |
|---|---:|
| image below 256 B (probe/polyglot candidate) | 77 |
| dotfile (.htaccess-style) is never allowed | 1 |
| content type "…" is not allow-listed for editor | 12 |
| hostile markers inside content: php-open-tag, php-call | 8 |
| hostile markers inside content: shell-call | 2 |
| hostile markers inside content: apache-directive | 3 |
| hostile markers inside content: imagemagick-mvg | 1 |
| video below 1024 B | 1 |
| hostile markers inside content: php-open-tag, phar-stub | 1 |
| hostile markers inside content: script-tag | 1 |

## 3. Antivirus gate

Windows Defender custom scan of `D:\mostqel\aawraq-quarantine\user-files`: **clean**; 0 detections; 1173 files still present after the scan; signatures 1.463.155.0 (2026-11-06T03:56:00.0000000Z); real-time protection on.

## 4. Local staging (private bucket `legacy-staging`)

| status/scope | rows | unique objects | bytes of rows |
|---|---:|---:|---:|
| rejected/editor | 90 | 0 | 19.1 MB |
| staged/editor | 18 | 8 | 4.6 MB |
| inventoried/editor | 95 | 0 | 89.8 MB |
| staged/product | 271 | 264 | 390.1 MB |
| inventoried/product | 789 | 0 | 6157.5 MB |

Latest migration runs: none.

## 5. Disk

- C: free (hosts the Docker/Supabase volumes): 8.21 GiB
- D: free (hosts quarantine D:\mostqel\aawraq-quarantine): 176.70 GiB
