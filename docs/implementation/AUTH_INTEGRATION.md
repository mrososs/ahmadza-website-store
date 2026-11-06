# Auth integration (Supabase Auth + Nuxt SSR)

## Implementation (verified locally)
| Concern | Implementation | Verified by |
|---|---|---|
| Sessions | `@nuxtjs/supabase` 2.x cookie sessions (`@supabase/ssr`); `sameSite=lax`, `secure` in production; server reads the user from the JWT (`serverSupabaseUser`) | `tests/api/auth.test.ts`, browser walk-throughs |
| Registration | `/register` → Supabase `signUp`; e-mail confirmation required (no session until confirmed); identical response for known/unknown e-mails (no enumeration) | auth.test (Mailpit message + `email_not_confirmed`) |
| Login / logout | `/login` (same-site `?redirect=` only), logout in `SiteHeader` | auth.test |
| Recovery | `/forgot-password` → recovery link → `/confirm` → `/reset-password` | auth.test |
| Profile creation | DB trigger `on_auth_user_created` creates `profiles` (only `display_name` is read from metadata) | rls tests |
| Roles | **only** `public.user_roles` (never `user_metadata`); `is_admin()` is SECURITY DEFINER and optionally requires `aal2` | `rls.test.ts`, `auth.test.ts` (self-promotion refused) |
| Route protection | UX middleware `auth`/`guest`/`admin` + **server** guards `requireUser/Affiliate/Admin` on every private API | `admin.test.ts` 401/403 matrix |
| Account state | banned/review accounts cannot purchase or comment (DB-enforced) | commerce/comments tests |
| Keys | publishable key in browser/SSR, secret key server-only; startup guard against wrong project | `supabase-target.test.ts` |

## Administrator bootstrap (no hardcoded password)
```text
node scripts/admin/bootstrap-admin.mjs --email <owner> --invite                       # user receives an invitation and sets their own password
node scripts/admin/bootstrap-admin.mjs --email <owner> --grant                        # after they confirmed: inserts user_roles(admin) — audited
# hosted: add  --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo --yes
```
The script has no password option, refuses unconfirmed users, refuses any project except local or `ubjuyeccioflhpcpnhmo`, and never prints the secret key.
**Before production release:** enrol a TOTP factor for every admin (Supabase MFA is enabled in `supabase/config.toml`; the enrolment screen is not built — `10-remaining-blockers.md`), *then* set `site_settings.require_admin_mfa = true`. Turning the flag on first locks admins out.

## Hosted settings to configure when access exists (Dashboard → Authentication)
| Setting | Value |
|---|---|
| Site URL | the real production URL **once it exists** (not invented now). Until then use the local URL `http://127.0.0.1:3000`. |
| Redirect URLs (allow-list) | exactly `http://127.0.0.1:3000/confirm` and `http://localhost:3000/confirm` for development; add the production `/confirm` URL at deployment. **No wildcards.** |
| Email provider | enabled; **Confirm email = ON**; secure password change ON; double-confirm email change ON |
| Password policy | minimum length 8 (matches local); enable **leaked-password protection** where the plan supports it |
| MFA | TOTP enrol + verify enabled |
| Sign-ups | enabled (customers register themselves); admins are never created by sign-up |
| SMTP | the built-in sender is rate-limited and for testing only: configure a custom SMTP provider with SPF/DKIM before launch |
| Rate limits | keep defaults at minimum; review sign-in/OTP limits after SMTP is set |
| JWT / sessions | defaults (1 h access token, refresh rotation on); the cookie max-age in `nuxt.config.ts` is 8 h |

## What changes at deployment
1. `NUXT_PUBLIC_SITE_URL` → real origin (referral links, redirects).
2. Add the production `/confirm` redirect URL and Site URL in the hosted Auth settings.
3. `secure` cookies are automatic in production; serve over HTTPS only.
4. Custom SMTP; admin MFA enrolment; then `require_admin_mfa = true`.
