# Protected client preview: exact deployment configuration

Status 2026-11-07: **deployed as a protected preview** at https://aawraq-store.vercel.app (section 5b). It is not a public launch: it needs the password, checkout is off, and nothing is indexed. Everything below is the configuration the deployment uses.

## 1. What the preview is

The same application, run in production mode, with these behaviours (all enforced by the server, all tested):

| Behaviour | How |
|---|---|
| Nothing is served without a password | HTTP Basic auth on every request; scrypt hash from the environment; wrong attempts rate-limited |
| Fail closed | production defaults to protected; missing or unusable credentials answer 503 for everything; only the explicit word `open` unprotects |
| Not indexed, not cached | `X-Robots-Tag: noindex`, `Cache-Control: private, no-store` forced on every response (also errors and route-rule pages) |
| No money, no files | creating a payment, payment webhooks and downloads answer 503; the list of payment methods answers an empty list |
| Administrators need a second factor | `/api/admin/**` requires an `aal2` session (TOTP) when `NUXT_ADMIN_REQUIRE_MFA` is true (the production default) |
| Honest empty states | unavailable payment methods, missing covers and not-yet-available files say so; nothing pretends |

## 2. What must exist first (these block the preview from showing real data)

1. **Migrations applied to the hosted project `ubjuyeccioflhpcpnhmo`.** Done: 19 of 19 (verified read-only with `node scripts/db/verify-hosted-after-push.mjs --confirm ubjuyeccioflhpcpnhmo --list-only`; schema fingerprints identical to local; Security and Performance advisors show no ERROR). The hosted database is empty: 0 books, 0 categories, 0 authors, 0 orders, 0 payments, 0 users.
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

## 5b. Deploying on Vercel

**Status (2026-11-07): deployed.** Vercel project `aawraq-store` (its own project; the account's other projects were not touched), production URL **https://aawraq-store.vercel.app**, Node 24.x, framework Nuxt, serving the protected preview against the hosted Supabase project `ubjuyeccioflhpcpnhmo`. The repository is linked for commit metadata, but **automatic Git deployments are switched off** (`vercel.json`), see below. The preview password is in `C:\Users\OMHAMED-OSAMA\aawraq-preview-credentials.txt` (outside the repository); only its scrypt hash is in Vercel (Sensitive).

Verified against the live URL: `scripts/preview/verify-preview.mjs` (9 checks), `tests/e2e/preview-production.spec.ts` (9) and `tests/e2e/preview-deployed-smoke.spec.ts` (7), all in a real browser at 1440 and 390 px.

What the repository already does for Vercel:
* **A protected production build carries no shared-cache rules.** On Vercel an `swr` route rule becomes an edge-cached page that is served *without* running the password gate. The default (protected) build therefore has none. If a protected deployment is ever started from a build that was made with page caching, the server **refuses to start on Vercel** (`protected_build_has_page_caching`).
* `.vercelignore` keeps env files, recovery output, PDFs and build folders out of a CLI upload.
* Responses carry `Cache-Control: private, no-store` (forced, including error pages), `X-Robots-Tag: noindex`.

How it is deployed (repeat this for every release):
1. Make sure the licensed legacy assets are present in the checkout: `npm run assets:sync` (the Janna LT fonts and the template `admin.css` are **not** in the repository; without them the Arabic typeface falls back and the admin area is unstyled).
2. `vercel deploy --prod` from that checkout. **Do not rely on a push:** `vercel.json` disables Git-triggered deployments on purpose, because a build made from GitHub lacks those assets and would silently replace a good deployment.
3. Run `scripts/preview/verify-preview.mjs` and the two Playwright specs against the URL (commands in their headers). The deployment is not ready to share until all pass.

Environment of the project (Production target; names only, set with `vercel env add`, values never in the repository): `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_KEY` (the publishable key, deliberately public), `NUXT_SUPABASE_SECRET_KEY` (Sensitive, server only), `NUXT_PUBLIC_SITE_URL`, `NUXT_PREVIEW_USER`, `NUXT_PREVIEW_PASSWORD_HASH` (Sensitive), `NUXT_ADMIN_REQUIRE_MFA=true`, `NUXT_MEDIA_ENABLED_PROVIDERS=external`, `NUXT_PAYMENTS_ENABLED_PROVIDERS=none` (enables no provider), `NUXT_ALLOW_DEV_PAYMENT_SIMULATOR=false`. `NUXT_PREVIEW_MODE` is not set.

Project settings applied through the Vercel API: Node 24.x (the version the tests ran on), and Vercel Authentication narrowed to previews and per-deployment URLs, so the production address is reachable by the client and protected by the application's own password gate (the default would have put even the production address behind a Vercel login).

Found only on the real platform, and fixed: Vercel's function runtime refuses `require()` of an ES module (`ERR_REQUIRE_ESM`), which broke every route importing `sanitize-html`; Nitro now bundles that package (`nuxt.config.ts`). The footer and cart no longer send a request that a protected preview is certain to refuse: in a protected preview `GET /api/checkout/methods` answers `{ methods: [] }`.

Properties of Vercel you should know (they cannot be changed from inside the application):
* **Static files are served by the CDN before the application runs**: the JavaScript and CSS bundle, fonts and images under `/_nuxt/` and `/assets/` are reachable without the password. They contain the application's code and design, no data (checked: no secret key, no password hash, no service-role token in the public bundle). Everything with content (HTML, API, sitemap) is behind the gate. **This includes the licensed Janna LT fonts and the template `admin.css`**, which any visitor who knows the paths can download (a web font has to be downloadable by the browser to be used). If you do not want that, decide before the client is invited (see the report).
* Serverless instances do not share memory, so the login-attempt limiter is **per instance**. The scrypt password cost and the 20-attempt window still apply per instance; use a long password and Vercel's firewall rate limiting if you want a global limit.
* The payment webhook endpoints answer 503 behind the gate by design; sandbox payment tests need a separate deployment (`PAYMENTS_GO_LIVE_CHECKLIST.md`).

## 6. After deployment

1. Sign in as the administrator, enrol the authenticator, then review `Catalogue recovery` and `Payments` in the admin.
2. Remove the local redirect URLs from Auth settings before any public launch.
3. To make the site public later: set `NUXT_PREVIEW_MODE=open` deliberately, complete `PAYMENTS_GO_LIVE_CHECKLIST.md`, and re-run the verification script's logic in reverse (the gate should be gone).
