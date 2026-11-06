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

## Hosted state — verified 2026-11-06 (`scripts/admin/verify-hosted-auth.mjs`; sends no e-mail, deletes its synthetic user)
| Check | Result |
|---|---|
| E-mail provider enabled · sign-ups enabled · **e-mail confirmation required** (autoconfirm off) | ✅ |
| Phone, social/SSO, anonymous sign-ins | ✅ all off |
| Foreign redirect URL (`https://attacker.invalid/…`) | ✅ not honoured — replaced by the Site URL |
| `http://127.0.0.1:3000/confirm?next=/reset-password`, `http://localhost:3000/confirm` | allowed (development) |
| Effective Site URL | `http://localhost:3000` (Supabase default — **not yet the real domain**) |
| Login with a confirmed account over the Data API + the Nuxt session cookie, admin vs customer vs guest on the admin API | ✅ (`tests/hosted/*`) |

## Settings that need YOUR input (the agent cannot read or change them: no Management API token, and it must not guess)
| Item | What I need / what to do (Dashboard → Authentication) |
|---|---|
| **First administrator** | give me the e-mail address (I will not assume one). Then: `node scripts/admin/bootstrap-admin.mjs --email <address> --invite --env .env.hosted --confirm-project ubjuyeccioflhpcpnhmo --yes`; after they open the link and set their OWN password: same command with `--grant`. No password is ever created by us. |
| Redirect allow-list | confirm it contains only the exact `/confirm` URLs (dev now; the production one later) and **no wildcard** — the allow-list contents cannot be read from here |
| Site URL | set to the real production origin once it exists (until then keep the local value) |
| SMTP | custom provider with SPF/DKIM before launch (the built-in sender is rate-limited, testing only). I need: host, port, user, sender address — enter the password in the dashboard yourself |
| Password policy / leaked-password protection | minimum length 8; enable leaked-password protection if your plan supports it |
| MFA | TOTP is enabled; the enrolment screen is not built — do **not** set `site_settings.require_admin_mfa` until it is |
| E-mail templates | review the Arabic wording of confirm / recovery / invite templates |

## What changes at deployment
1. `NUXT_PUBLIC_SITE_URL` → real origin (referral links, redirects).
2. Add the production `/confirm` redirect URL and Site URL in the hosted Auth settings.
3. `secure` cookies are automatic in production; serve over HTTPS only.
4. Custom SMTP; admin MFA enrolment; then `require_admin_mfa = true`.
