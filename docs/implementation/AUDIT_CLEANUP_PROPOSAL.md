# Proposal — removing the 10 synthetic audit rows (NOT executed)

## What they are
Hosted test runs on 2026-11-06 created five throwaway admin users and granted/revoked the `admin` role on each. The `user_roles` audit trigger recorded one `insert` and one `delete` per user, with no row id and no human actor. The five users no longer exist; `auth.users` and `user_roles` are empty. Nothing else is in `audit_log` (10 rows total). **They stay untouched for now.** Later test runs no longer add any (the test cleanup removes only its own rows, matched by its own fixture user ids).

| audit id | event | synthetic user |
|---|---|---|
| 1, 6 | admin grant / revoke | `5d1f4582-f349-4124-b7f4-f18223bb6ad4` |
| 7, 12 | admin grant / revoke | `668234c9-5ff4-42a3-b1f2-081a82d9bc1f` |
| 13, 32 | admin grant / revoke | `4658d5b9-92c2-4a19-92e4-c54049dfc9ab` |
| 33, 52 | admin grant / revoke | `8484f422-bea2-42a6-825f-b0e9940bb9dc` |
| 53, 58 | admin grant / revoke | `f8d993b7-4731-4150-87a9-04c9c725ba1b` |

## The cleanup (`scripts/db/cleanup-synthetic-audit.sql`) — why it cannot touch real data
One transaction; any failed guard aborts everything:
1. **Explicit ids only** — a fixed list of 10 audit ids, never a pattern or a time range. Rows created later (including every real admin grant) have higher ids and are not in the list.
2. **Checksum per row** — each row must still equal the MD5 of its full content (`id, actor, action, entity, entity_id, diff, created_at`) recorded when it was reviewed; an edited or replaced row aborts the run. Verified against the live table on 2026-11-06 (combined digest `ec87ef7ef4a0f992ca2bd0c767d7c66e` matches).
3. **Shape check** — every row must be a `user_roles` insert/delete with no human actor, whose user id equals the listed synthetic user.
4. **No real account can be involved** — none of the five users may exist in `auth.users` at run time.
5. **Self-documenting** — it inserts an `audit_log` row (`action='cleanup'`) naming the deleted ids, count and this proposal, so the removal is itself audited.

## Evidence it works (all non-destructive to real data)
* Guards 1–4 were run as a read-only `SELECT` against the live hosted table: `listed 10 · checksum matches 10 · unexpected rows 0 · synthetic users alive 0`.
* The full script was run on the **local** stack against two fabricated stand-in rows: with one checksum tampered it aborted ("only 1 of 2 rows match") and deleted nothing; with correct values it deleted exactly those 2 rows and wrote the cleanup record. The local test record was removed afterwards.
* A first draft contained a one-character checksum typo (row 58); the combined-digest comparison caught it before this proposal was written. Re-verify the digest before running.

## When and how (owner decision, right before launch)
1. Re-run the read-only guard check (`docs/implementation/HOSTED_MIGRATION_RUNBOOK.md` §6b style) or the combined digest query; it must still say 10/10.
2. Run `scripts/db/cleanup-synthetic-audit.sql` manually in the SQL editor with a role that can delete from `audit_log` (service/`postgres`). Expected output: the new `cleanup` record listing `[1,6,7,12,13,32,33,52,53,58]`.
3. Skip it entirely if you prefer to keep the rows: they contain no personal data and are clearly synthetic; the cost of keeping them is only noise.
