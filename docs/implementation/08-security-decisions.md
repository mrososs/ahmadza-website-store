# 08 — Security decisions

Maps the findings of `docs/legacy-audit/12-technical-debt-and-risks.md` and `13` §6 to what was built. "Tested" names the suite that asserts it.

| Legacy finding | Decision / control | Tested |
|---|---|---|
| Plaintext default passwords, mailed to guests | No stored/mailed passwords; Supabase Auth; confirmation on; guest checkout dropped | `tests/api/auth.test.ts` |
| Weak seeded admin credential, flat role | `user_roles` + `is_admin()`; no seeded admin password; optional AAL2 requirement | `tests/db/rls.test.ts` |
| Unauthenticated editor upload; hostile July-2026 payloads | admin-only upload routes, magic-byte allow-list, size caps; hostile samples are built in-memory as byte arrays in tests, never extracted from the archive | `tests/api/admin.test.ts`, `tests/unit/migration-*` |
| Public capability URL for IBAN / Ministry documents | private-sensitive bucket, no storage policies, owner/admin signed URLs only | `tests/api/affiliate.test.ts` |
| Paid PDFs reachable by URL | private-products bucket, entitlement check, short-lived signed URL (`signedUrlTtlSeconds`) | `tests/api/checkout.test.ts`, `tests/db/rls.test.ts` |
| Money as strings / float math / unlocked balance | `numeric(12,2)`, append-only ledger, `request_withdrawal` per-affiliate row lock | `tests/db/affiliate.test.ts` |
| Payment callback/webhook race and duplicate fulfilment | `payments` first, `fulfill_payment` idempotent + unique provider txn id, `payment_events` unique(provider,event_id), raw-body signature verification | `tests/db/commerce.test.ts`, `tests/api/checkout.test.ts` |
| Test-mode orders granting access/commission | `allow_test_payments` off by default; `is_test` flags; dev simulator constrained to test mode and refused in production | `tests/db/commerce.test.ts` |
| Banned users could log in and buy | enforced in `create_payment_for_cart` and RLS check on comments | `tests/db/commerce.test.ts`, `tests/db/comments.test.ts` |
| Public state-changing GET endpoints (mass mail, affiliate release) | not implemented; availability is time-based on the ledger (`available_at <= now()`), no job needed | `tests/db/affiliate.test.ts` |
| Raw HTML rendered unescaped (stored XSS) | `sanitizeRichText` on save; `v-html` only for sanitised CMS fields | `tests/api/admin.test.ts` |
| Raw dynamic SQL from URL segments | none; typed Supabase queries / parameterised SQL functions | — |
| Orders mutable / cascade deletes erase purchases | immutability triggers, `ON DELETE RESTRICT` on transactional FKs | `tests/db/commerce.test.ts` |
| No rate limiting | `rateLimit()` on contact, checkout, downloads; GoTrue throttling for auth | `tests/api/*` |
| Secrets in the legacy tree | never read, printed or copied; `.env` git-ignored; `.env.example` has names only | manual |

## Environment safety
* Every script and test refuses a non-local Supabase URL. No `supabase link`, remote push or hosted project was used.
* Security headers on all responses (`x-content-type-options`, `referrer-policy`, `x-frame-options`). A strict CSP is an open item (the preserved legacy markup uses inline styles/scripts that must be audited first).
* The recovered archives were treated as hostile: listed, hash-verified, extracted only to `D:\mostqel\aawraq-quarantine\` (outside the project and any web root), content-sniffed, scanned, and the hostile payload files were excluded — see `07-historical-data-import.md`.

## Residual risks (see `10-remaining-blockers.md`)
Real payment gateways are not integrated (no sandbox credentials); in-memory rate limiter is per-instance; field-level encryption for payout details and IBANs; CSP; admin MFA enrolment UI; secret rotation of the legacy VPS (owner action).
