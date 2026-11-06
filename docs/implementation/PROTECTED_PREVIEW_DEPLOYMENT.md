# Protected client preview: exact deployment configuration

Status 2026-11-06: **built and verified locally, not deployed.** No hosting access has been authorised, and publishing the site anywhere is your decision. Everything below is what a deployment needs. The production build succeeds (`npx nuxt build`).

## 1. What the preview is

The same application, run in production mode, with these behaviours (all enforced by the server, all tested):

| Behaviour | How |
|---|---|
| Nothing is served without a password | HTTP Basic auth on every request; scrypt hash from the environment; wrong attempts rate-limited |
| Fail closed | production defaults to protected; missing or unusable credentials answer 503 for everything; only the explicit word `open` unprotects |
| Not indexed, not cached | `X-Robots-Tag: noindex`, `Cache-Control: private, no-store` forced on every response (also errors and route-rule pages) |
| No money, no files | checkout, payment webhooks and downloads answer 503 |
| Administrators need a second factor | `/api/admin/**` requires an `aal2` session (TOTP) when `NUXT_ADMIN_REQUIRE_MFA` is true (the production default) |
| Honest empty states | unavailable payment methods, missing covers and not-yet-available files say so; nothing pretends |

## 2. What must exist first (these block the preview from showing real data)

1. **Migrations 18 and 19 applied to the hosted project `ubjuyeccioflhpcpnhmo`.** Not applied. Run it yourself (the CLI refuses a remote write from an agent session): 
   ```powershell
   npx supabase db push --remote --dry-run     # review: exactly two pending migrations, 20261117000000 and 20261118000000
   npx supabase db push --remote
   ```
   Afterwards run `node scripts/db/fingerprint.mjs --emit-sql` against hosted (see `HOSTED_MIGRATION_RUNBOOK.md`) and compare with the local fingerprint.
2. **Auth redirect settings** and **SMTP** (`AUTH_PREVIEW_AND_SMTP.md`): without custom SMTP, confirmation and reset e-mails reach only your Supabase organisation members.
3. **An administrator** invited with `scripts/admin/bootstrap-admin.mjs` using the e-mail you approve (none has been invented), who then enrols the authenticator at `/admin/security`.
4. The production build refuses a local Supabase URL by design: it only runs against the authorised hosted project.

## 3. Environment (server-only unless it starts with `NUXT_PUBLIC_`)

```
NODE_ENV=production
NUXT_PUBLIC_SUPABASE_URL=https://ubjuyeccioflhpcpnhmo.supabase.co
NUXT_PUBLIC_SUPABASE_KEY=<publishable key>
NUXT_SUPABASE_SECRET_KEY=<secret key>              # never in the browser bundle, never in the repository
NUXT_PUBLIC_SITE_URL=https://<preview origin>

# the protected-preview gate
NUXT_PREVIEW_USER=<user name you choose>
NUXT_PREVIEW_PASSWORD_HASH=<output of: node scripts/preview/hash-password.mjs>   # the password itself is never stored

# leave these as they are for a preview
NUXT_ADMIN_REQUIRE_MFA=true
NUXT_MEDIA_ENABLED_PROVIDERS=external
NUXT_PAYMENTS_ENABLED_PROVIDERS=                    # empty: no payment method is offered
# NUXT_PAYMENTS_LIVE_ENABLED is not set: live payments stay off
```

Generate the hash on your own machine (the password is typed without echo and is not printed). Share the password with the client through a different channel than the URL.

## 4. Build and run

```
npm ci
npx nuxt build                         # output in .output/
node .output/server/index.mjs          # PORT=3000 by default
```

Run it behind a TLS-terminating reverse proxy (nginx, Caddy, OpenLiteSpeed, a platform router). Requirements for the proxy:
* serve **https only**, redirect http to https;
* pass the real client address in `X-Forwarded-For` (the rate limiters key on it), and do not let clients set that header themselves;
* do not cache responses and do not strip `Authorization`, `X-Robots-Tag` or `WWW-Authenticate`;
* keep a process manager (systemd, pm2, the platform's own) with automatic restart.

Never run this on the legacy VPS: it still has unreviewed security indicators (`VPS_SECURITY_GATE.md`).

## 5. Verify the deployment from outside

```
PREVIEW_PASSWORD=<the password> node scripts/preview/verify-preview.mjs https://<preview origin> <user>
```
It checks, over the network: https, a 401 challenge with no content and a noindex header for anonymous visitors (pages, admin, API), an open `robots.txt` that disallows everything, wrong credentials refused, valid credentials reaching the site with no-store, checkout, webhooks and downloads answering 503, and the admin API still demanding a session. Exit code 0 means every check passed; anything else means do not share the link.

## 6. After deployment

1. Sign in as the administrator, enrol the authenticator, then review `Catalogue recovery` and `Payments` in the admin.
2. Remove the local redirect URLs from Auth settings before any public launch.
3. To make the site public later: set `NUXT_PREVIEW_MODE=open` deliberately, complete `PAYMENTS_GO_LIVE_CHECKLIST.md`, and re-run the verification script's logic in reverse (the gate should be gone).
