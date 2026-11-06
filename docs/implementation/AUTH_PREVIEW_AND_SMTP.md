# Auth for the protected preview — Site URL, redirect allow-list, SMTP

**No deployment domain is assumed anywhere.** Everything below uses `<PREVIEW_ORIGIN>` = the real https origin of the protected preview (scheme + host, no path, e.g. what Hostinger/your host gives you). Send it to me when it exists.

## 1. What the app sends to Supabase Auth (from the code)
| Flow | Redirect the app requests | Source |
|---|---|---|
| Register | `<NUXT_PUBLIC_SITE_URL>/confirm` | `app/pages/register.vue` |
| Forgot password | `<NUXT_PUBLIC_SITE_URL>/confirm?next=/reset-password` | `app/pages/forgot-password.vue` |
| Affiliate registration | `<browser origin>/confirm?next=/affiliate-register` | `app/pages/affiliate-register.vue` |
| Admin invitation | `<NUXT_PUBLIC_SITE_URL>/confirm` | `scripts/admin/bootstrap-admin.mjs` |

So three things must agree: the deployed app's `NUXT_PUBLIC_SITE_URL`, the Auth **Site URL**, and the Auth **redirect allow-list**.

## 2. Exact settings (Dashboard → Authentication → URL Configuration)
| Setting | Value |
|---|---|
| Site URL | `<PREVIEW_ORIGIN>` |
| Redirect URLs (allow-list) | `<PREVIEW_ORIGIN>/confirm` — plus, only while developing, `http://127.0.0.1:3000/confirm` and `http://localhost:3000/confirm`. **No wildcards, no `*.vercel.app`-style patterns.** Remove the two local entries before public launch. |
| App environment (preview deployment) | `NUXT_PUBLIC_SITE_URL=<PREVIEW_ORIGIN>` (referral links and e-mail redirects use it) |

Verified today on hosted: sign-ups on, e-mail confirmation required, foreign redirects refused (replaced by the Site URL, currently the Supabase default `http://localhost:3000`). The allow-list contents cannot be read from outside the dashboard; the script below proves behaviour instead.

## 3. Proof step (I run it after you set the values; sends no e-mail, deletes its synthetic user)
```powershell
node scripts/admin/verify-hosted-auth.mjs --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo --preview-origin <PREVIEW_ORIGIN>
```
Expected: `preview callback allowed` ×3 (`/confirm`, `/confirm?next=/reset-password`, `/confirm?next=/affiliate-register`), `a look-alike origin is NOT honoured`, `a foreign redirect URL is NOT honoured`, `synthetic user removed`. Tested against a placeholder origin that is not allow-listed: the three callback checks fail as they should.

## 4. Does e-mail need custom SMTP? **Yes.**
From Supabase's own Auth documentation (queried 2026-11-06): until custom SMTP is configured the built-in sender
* delivers **only to the e-mail addresses of your Supabase organisation's team members** — any other address fails with `email_address_not_authorized`;
* is limited to a small number of e-mails per hour for the whole project while *Confirm email* is on (`over_email_send_rate_limit` / HTTP 429);
* is "best-effort, no SLA", for testing templates with the team only.

Consequences for AAWRAQ: customers cannot receive confirmation or password-reset mails, and **the first-admin invitation only works if the admin's address belongs to your Supabase organisation team** until SMTP is configured.

### What I need from you (never send the password — enter it in the dashboard yourself)
| Item | Notes |
|---|---|
| SMTP provider | any transactional provider you already use or choose (SES, Postmark, Resend, Brevo, your host's SMTP) |
| Host and port | e.g. 587 (STARTTLS) or 465 (TLS) |
| Username | the provider's SMTP user |
| Sender address + name | an address on a domain you control, e.g. `no-reply@<your-domain>`; name `أوراق عربية` |
| DNS | SPF and DKIM (and ideally DMARC) records for the sending domain, from the provider |
| Dashboard | Authentication → Emails → SMTP Settings → enable custom SMTP; then Authentication → Rate Limits: review the e-mail limit (the built-in cap no longer applies) |
| Templates | review Arabic wording of Confirm signup / Reset password / Invite user (Authentication → Emails → Templates); they must link to `{{ .ConfirmationURL }}` unchanged |

After you finish, I can test delivery safely by generating (not sending) links with the script above, and send exactly one real test mail to an address you name.

## 5. First administrator (waiting for your e-mail address, to be sent securely)
1. If SMTP is not configured yet, the address must be an organisation team member (see §4).
2. `node scripts/admin/bootstrap-admin.mjs --email <ADMIN_EMAIL> --invite --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo --yes` — they receive the invitation and **set their own password**.
3. After they confirm: same command with `--grant` (adds the `admin` role, audited). No default password exists anywhere; the script has no password option (tested: `tests/api/bootstrap-admin.test.ts`).
4. Do not enable `site_settings.require_admin_mfa` until the TOTP enrolment screen exists.
