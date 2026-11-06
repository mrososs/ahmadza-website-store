# VPS storage security gate — GO / NO-GO

Assessment date: 2026-11-06. Basis: **recovered archives and the legacy audit only** (`docs/legacy-audit/09`, `12`, `16`, `17`). The VPS has **not** been inspected live (no access from the agent environment); `scripts/vps/readonly-inspect.sh` is prepared for the owner to run in the Hostinger Web Console.

## Verdict
| Target | Decision | Why |
|---|---|---|
| Deploy the private media service **onto the existing legacy VPS** | **NO-GO** until the inspection output clears it | Hostile upload artifacts were found in the recovered legacy upload folder; the legacy upload endpoint was unauthenticated; no access/error logs, provider snapshots or database were recovered, so **whether any payload executed cannot be ruled out** (risk register item RISK-49 in the private audit). All legacy secrets are presumed exposed. The server also hosts other sites and its database service was previously unhealthy. Putting a new signing secret, upload token and private PDFs on a host that may be compromised would hand them to an attacker. (Details — file names, dates, payload types — are kept in the private audit evidence, deliberately not in this public repository.) |
| Develop and test the adapter + service **locally** | **GO** (done) | `server/services/storage/*`, `services/media-server/server.mjs`, 16 passing tests. |
| Deploy the same service on a **new, clean** host (new VPS or a freshly rebuilt one) | **GO once a host exists** | Nothing in the design depends on the legacy server. |

## What would change NO-GO to a conditional GO on the existing VPS
All of the following from the inspection script's output **and** an owner decision:
1. §5 "script-like files inside upload/storage trees" is empty or only the already-known quarantined names; no `<?php` matches in `storage/app`; no webshell-pattern matches in `app/ public/ routes/ bootstrap/`.
2. §6: no unknown UID-0 account, no unknown `authorized_keys` fingerprint, no unexplained accepted SSH logins, no unexplained high-CPU process, no unexpected listening port, no unknown SUID files.
3. Access logs (the site log directory and the web-server logs) exist from the first suspicious upload date (see the private audit) until now and show no execution of the dropped files (this must be reviewed by the owner/an engineer; the script lists only names and dates).
4. A provider snapshot from **before the first suspicious upload date** exists (hPanel) — it provides a trusted rebuild source.
5. The owner has rotated every legacy secret (DB, APP_KEY, mail, Paymob/Tap keys and webhook secrets, Sentry, backup password, admin passwords).
Even then the recommended path is a **rebuild**: a fresh AlmaLinux/Debian VPS, media copied only from the verified quarantine manifest (sha256-checked, magic-byte + antivirus gated), legacy server kept read-only for evidence.

## Delivery design (implemented, unverified against the real server)
* **Not Nginx / `X-Accel-Redirect`** — the legacy host is OpenLiteSpeed/CyberPanel; the service does not need either. It is a standalone zero-dependency Node process (`services/media-server/server.mjs`) listening on `127.0.0.1:8787`, run under a **dedicated unprivileged user** with `MEDIA_ROOT` outside every web root.
* TLS is terminated by whatever front proxy the host has (OpenLiteSpeed **proxy context**, Caddy or Nginx). The front proxy must forward only `/objects/*` and `/healthz`, set `MEDIA_TRUST_PROXY=1` only when it overwrites `X-Forwarded-For`, and must not expose PUT/DELETE publicly (restrict them to the Nuxt server's IP/mTLS **in addition to** the bearer token).
* Authorisation: Nuxt validates session + published + preview/free/entitlement/admin, then `VpsStorageAdapter.deliver` HEAD-checks the object and returns a 302 to a URL carrying `exp`, `dn` and an HMAC-SHA256 bound to **one key + one expiry + one file name** (default TTL 120 s; service rejects tokens with a lifetime above `MEDIA_MAX_TTL`, default 300 s). Secrets rotate by listing two in `MEDIA_SIGNING_SECRETS`.
* The service never accepts a path: keys must match a strict pattern (`sha256/<aa>/<64 hex>.<ext>` or `books/<id>/<uuid>.<ext>`), the query string is never logged, objects are served as `attachment` + `nosniff` + `no-store`, `Range` (206/416) is supported, uploads need the bearer token, a recomputed SHA-256, magic bytes, no-overwrite (hard-link), content-addressed key = hash, and deletes are moves to `trash/`.
* Per-IP rate limits: downloads 120/min, failed signatures 20/min (lock-out), uploads 30/min.

## Tests that exist (`tests/unit/media-server.test.ts`, 16 passing)
valid download · Range (partial/open/suffix/416/junk) · missing/garbage/tampered token (name, expiry) · token of another object · expired and over-long tokens · missing file · traversal/percent-encoded/odd keys · wrong methods · signature absent from logs · upload auth, checksum, magic bytes, content-addressing, overwrite refusal, no temp leftovers · delete → trash · rate limit + failure lock-out · Nuxt signer ↔ service verifier compatibility and secret rotation · adapter put/head/archive/deliver, unsafe keys, http/unconfigured refusal.
**Not yet tested:** behaviour behind OpenLiteSpeed/Caddy/Nginx, real TLS, large-file (≥ 80 MB) throughput, systemd hardening, ClamAV on upload, backups. These need the target host.

## Configuration that is **not** applied anywhere (prepared diff, for approval)
On the target host only, after the gate: create user `aawraq-media` (no shell); `MEDIA_ROOT=/srv/aawraq-media` mode `0750` owned by that user, mounted `noexec,nosuid,nodev` if a separate volume; systemd unit with `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/srv/aawraq-media`, `PrivateTmp=yes`; env file (mode `0600`) holding `MEDIA_ROOT`, `MEDIA_SIGNING_SECRETS`, `MEDIA_UPLOAD_TOKEN`; front-proxy vhost for `files.<domain>` forwarding `/objects/` to `127.0.0.1:8787`. Nuxt side: `NUXT_VPS_STORAGE_BASE_URL`, `NUXT_VPS_STORAGE_SIGNING_SECRET`, `NUXT_VPS_STORAGE_UPLOAD_TOKEN` (server-only), then add `vps` to `NUXT_MEDIA_ENABLED_PROVIDERS`. None of this has been executed.
