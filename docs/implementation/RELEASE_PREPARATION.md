# Release preparation: integrating `vps-recovery-prep` into `main`

Updated 2026-11-07 after the final verification run (results in `RELEASE_ACCEPTANCE_REPORT.md`). **No merge, no push and no deployment has been done.** Publishing is your decision.

## State

* `origin/main` is at `00a1bf5`. Local `main` is at `ea3c183`, one documentation commit ahead of it (never pushed).
* `vps-recovery-prep` is a **linear series of commits on top of `main`** (`git log --oneline main..HEAD`; its merge base is `main` itself). It integrates as a fast-forward: no merge commit, no conflicts.
* 171 files changed (about 13,300 added lines). Everything is committed; the working tree is clean.
* Hosted Supabase `ubjuyeccioflhpcpnhmo`: all 19 migrations applied by you, schema fingerprints identical to the local stack, advisors without errors, hosted integration suites passing, catalogue tables empty. No other project was touched.

## What a push would publish

`git push origin main` after the fast-forward publishes **`ea3c183` (docs) and every branch commit**: everything from `00a1bf5` to the branch head (`git log --oneline origin/main..vps-recovery-prep` lists them). Nothing else: no data, no PDFs, no environment files.

## Review before publishing

| Check | Result |
|---|---|
| Commit `ea3c183` (on `main`, unpublished) | two documentation files; no secrets, no personal data, no binaries |
| Secrets in `main..HEAD` (`sb_secret_`, JWTs, private keys, cloud/GitHub/Slack tokens, password assignments) | none |
| Private or heavy files in the range (`.env*` other than `.env.example`, keys, PDFs, archives, dumps, quarantine, `migration-output`) | none. `migration-output/`, `.env*`, `.nuxt*`, `.output` are git-ignored |
| Text fixtures (`tests/fixtures/vps-inspection/*.txt`) | synthetic scenario output: variable **names** only, `127.0.0.1` is the only address |
| Binary files in the range | two small fonts (`dropify.ttf`, `.woff`, `.eot`, 3 to 5 KB each), copies of the original site's own assets |
| Test data | synthetic only, tagged and cleaned up; never imported anywhere |

Re-run the scans yourself on the final state before pushing:

```powershell
git diff main..HEAD | Select-String -Pattern 'sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{20,}\.|PRIVATE KEY'
git diff --name-only main..HEAD | Select-String -Pattern '\.(pdf|zip|tar|gz|sql|dump|env|pem)$'
```

(The `.sql` hits are the two additive migrations, `20261117000000` and `20261118000000`.)

## The commits, in order

| Commit | What |
|---|---|
| `49caf34` `2ee09dd` `9265adb` `a3e414e` `852d395` | VPS read-only inspection tooling, classifier, isolated restore, physical-file recovery tool, plans |
| `e4be903` | partial-catalogue recovery: migration 18, importer, target policy, isolated recovery stack |
| `bba12ba` | catalogue recovery admin dashboard, readiness panel, missing-cover fallback |
| `0889a85` | fail-closed protected preview |
| `c421619` | safe acquisition plan, exact-version recovery, independent validator |
| `0c564a2` | migration 19 (payment binding, workflow status, evidence drafts, free claims, download audit) |
| `6a71c0d` | Paymob and Tap on the current official APIs |
| `758ff80` | admin MFA, production environment validation |
| `9682813` | workflow statuses, free-book claim, download audit, canonical URLs, journey fixes |
| `8d7aa38` | media reconciliation and evidence-based draft books |
| `4ebe411` `026f1b1` `863f063` | completion report, release preparation, preview deployment guide, verification script |
| `a4a7ff3` | payments: explicit currency confirmation, Paymob region, only usable methods |
| `c351704` | deployed-preview acceptance spec, Vercel notes, upload ignore list |
| `e1ed2f5` | admin review queue, read-only `/Launch` review, suspicious-PDF policy |
| `41c47f7` | hosted release suite and post-push verifier |
| `f830d1b` | admin: Arabic validation, safe social links, API error mapping, empty states |
| `c06c753` | payments table on phones, recovery wording, cart journey contract |

(The branch is only meaningful as a whole: later commits depend on configuration keys added by earlier ones.)

## Integration (when you decide)

```powershell
git switch main
git merge --ff-only vps-recovery-prep          # linear: no merge commit
npm ci; npm run lint; npm run typecheck; npm test   # needs the local stack
```

Publishing is a separate decision with consequences:

```powershell
git push origin main
```

Never force-push. Do not push `vps-recovery-prep` as a separate branch unless you want that history visible too.

## Order of operations for a working preview

1. ~~Apply migrations 18 and 19 to hosted~~ (done and verified).
2. Auth settings and SMTP (`AUTH_PREVIEW_AND_SMTP.md`), then the admin invitation and authenticator enrolment.
3. Create the hosting project and add the environment (`PROTECTED_PREVIEW_DEPLOYMENT.md`, section 5b for Vercel), deploy, and run `scripts/preview/verify-preview.mjs` and the `preview-production` spec against the real URL.
4. Review the recovered drafts in the admin (they exist only in the isolated recovery stack until you authorise importing them), set prices, attach validated files, publish.
5. Payments only after `PAYMENTS_GO_LIVE_CHECKLIST.md`.

## Rolling back

* Code: `git revert` the commit range, or reset `main` to `ea3c183` locally before anything is pushed.
* Database: migrations 18 and 19 are additive (new columns, functions, a table, a view change). They can be reversed with a new migration; nothing existing was dropped except the `books_provenance_check` constraint, which migration 19 replaces with a wider one. Reversing against hosted is a remote write and is yours to run.
