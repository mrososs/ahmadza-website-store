# Release preparation: integrating `vps-recovery-prep` into `main`

Prepared 2026-11-06. **Nothing here has been run.** No merge, no push, no deployment. Publishing is your decision.

## State

* `main` is at `ea3c183` (one commit ahead of `origin/main`: a documentation commit, reviewed below).
* `vps-recovery-prep` is **14 commits ahead of `main`**, linear (its merge base is `main` itself), so it integrates as a fast-forward with no merge commit and no conflicts.
* 140 files, about 10,500 added lines. Everything is committed; the working tree is clean.

## Review before publishing

| Check | Result |
|---|---|
| Unpublished commit `ea3c183` (on `main`) | two documentation files; no secrets, no personal data, no binaries |
| Secrets in the branch diff | none (`sb_secret_`, `sb_publishable_`, JWTs, private keys, cloud keys, password assignments all scanned) |
| Recovered PDFs, archives, dumps, quarantine, incident evidence | none tracked. `migration-output/`, `.env*`, `.nuxt-*` are git-ignored |
| Addresses and other sites' names in tracked docs | none (only the site's own domain and standard panel folders; one number that looked like an IP is an antivirus signature version) |
| Test data | synthetic only; fixtures tagged and cleaned up. The synthetic local catalogue is not imported anywhere |
| Hosted Supabase | untouched. Migrations 18 and 19 are pending there (verified by a read-only dry run) |

Re-run the scans yourself on the final state before pushing:

```powershell
git diff main..HEAD | Select-String -Pattern 'sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{20,}\.|PRIVATE KEY'
git diff --name-only main..HEAD | Select-String -Pattern '\.(pdf|zip|tar|gz|sql|dump|env|pem)$'
```

## The commits, in order

| Commit | What |
|---|---|
| `49caf34` `2ee09dd` `9265adb` `a3e414e` `852d395` | VPS read-only inspection tooling, classifier, isolated restore, physical-file recovery tool, plans |
| `e4be903` | partial-catalogue recovery: migration 18, importer, target policy, isolated recovery stack |
| `bba12ba` | catalogue recovery admin dashboard, readiness panel, missing-cover fallback |
| `0889a85` | fail-closed protected preview |
| `c421619` | safe acquisition plan, exact-version recovery, independent validator |
| `0c564a2` | migration 19 (payment binding, workflow status, evidence drafts, free claims, download audit) |
| `6a71c0d` | Paymob and Tap |
| `758ff80` | admin MFA, production environment validation |
| `9682813` | workflow statuses, free-book claim, download audit, canonical URLs, journey fixes |
| `8d7aa38` | media reconciliation and evidence-based drafts |

(The Paymob/Tap commit refers to configuration keys that the MFA commit adds to `nuxt.config.ts`; the branch is only meaningful as a whole.)

## Integration (when you decide)

```powershell
git switch main
git merge --ff-only vps-recovery-prep          # linear: no merge commit
npm ci; npm run lint; npm run typecheck; npm test   # needs the local stack and the dev server
```

Publishing is a separate decision with consequences:

```powershell
git push origin main
```

This would publish **both** the 14 branch commits **and** the earlier unpublished `ea3c183`. Never force-push. Do not push `vps-recovery-prep` as a separate branch unless you want that history visible too.

## Order of operations for a working preview

1. Apply migrations 18 and 19 to hosted (`npx supabase db push --remote --dry-run`, review, then without `--dry-run`).
2. Auth settings and SMTP (`AUTH_PREVIEW_AND_SMTP.md`), then the admin invitation.
3. Deploy the protected preview and verify it (`PROTECTED_PREVIEW_DEPLOYMENT.md`).
4. Review the recovered drafts in the admin, set prices, attach validated files, publish.
5. Payments only after `PAYMENTS_GO_LIVE_CHECKLIST.md`.

## Rolling back

* Code: `git revert` the commit range, or reset `main` to `ea3c183` locally before anything is pushed.
* Database: migrations 18 and 19 are additive (new columns, functions, a table, a view change). They can be reversed with a new migration; nothing existing was dropped except the `books_provenance_check` constraint, which migration 19 replaces with a wider one.
