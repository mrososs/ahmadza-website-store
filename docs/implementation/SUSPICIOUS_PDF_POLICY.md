# PDFs that carry a /Launch action: policy and review

Status 2026-11-07. **All 445 PDFs flagged for `/Launch` remain in quarantine and excluded from ingestion.** No PDF security check was relaxed, and no code path admits any of them.

## 1. What the PDF check refuses, and why

A `/Launch` action asks a PDF viewer to open or run another file when a reader clicks a link, bookmark or page event. It is the classic way for a PDF to deliver malware, and a book catalogue has no legitimate need for it. The ingestion checks therefore refuse it **by default and for every file**, whatever its name, size or source. That rule stays.

## 2. What the 445 actually are (read-only evidence)

`node scripts/recovery/review-launch-pdfs.mjs` reads the quarantined PDFs as bytes (nothing is opened, executed, copied, staged or imported; no database is touched) and groups each file by what its actions would launch. Results for the 1,059 recovered PDFs, 2026-11-07:

| Finding | Files |
|---|---|
| PDFs scanned (none unreadable) | 1,059 |
| PDFs containing `/Launch` (matches the 445 counted by the earlier evidence scan) | 445 |
| every action names **a plain PDF in the same folder** (`00_NNNNN.pdf`), no parameters, no directory override | 439 |
| at least one action whose target could not be read (blocked) | 6 |
| actions that name an executable, script, URL, network or absolute path, or a path outside the folder | **0** |
| actions with command-line parameters | **0** |

How to read this:
* The pattern (an Acrobat "open another file" bookmark to a sibling `00_NNNNN.pdf`) is what a document-management tool produces, which is more consistent with a legacy publishing workflow than with an attack. **That is a reading of the evidence, not a clearance.** A static byte scan cannot see an action stored inside a compressed object stream, a file that was altered after the fact, or a sibling that was swapped for something else.
* Nothing here changes the status of any file. `reviewable` means only that a person *may* look at it; `blocked` means at least one action could not be explained.
* The report (`migration-output/launch-pdf-review.json` and `.md`, git-ignored) names files by SHA-256 prefix. It is regenerated at will; it contains no private content.

## 3. How a file could ever be admitted (a separate, recorded process)

Not implemented, and not started. It needs your explicit decision first. Nothing in the application reads an allow-list, and no environment flag turns the check off. If you decide to pursue it, the only design that keeps the check intact is to **never admit the original**:

1. **Decide and record.** You state in writing which subset is in scope (for example, the 439 files whose only actions name a sibling PDF) and why. The decision is saved in the repository (`docs/implementation/`) with the date and the list of SHA-256 hashes covered. Without that record nothing proceeds.
2. **Produce a sanitised derivative, outside the application.** On an isolated machine with no access to production secrets, rewrite each file with a PDF tool that removes the actions (for example `qpdf` or Ghostscript run in a sandbox), producing a **new file with a new hash**. The original stays in quarantine, untouched.
3. **Re-run every existing check on the derivative.** The ordinary pipeline (magic bytes, structure, antivirus scan, `/JavaScript` / `/Launch` / `/OpenAction` / embedded-file markers, hash recorded) must pass with **no** exception. The derivative contains no `/Launch`, so no rule needs bending.
4. **Spot-check by a person**, in a disposable virtual machine, for a sample you choose, and compare page count and text with the original.
5. **Import as draft only**, into the isolated recovery stack first, never auto-published, with the original hash and the derivative hash both recorded as evidence (`recovery_evidence`).
6. **Hosted only with a further explicit authorisation.**

Files in the `blocked` group (the 6, and anything an inspection cannot explain) are not eligible for this route; they need a trusted replacement copy from the original publisher instead.

## 4. What is never done

* No PDF security check is disabled, relaxed or made conditional to raise the catalogue count.
* No allow-list, bypass flag or "trusted source" setting exists, and none should be added without a recorded owner decision and a code review.
* No quarantined original is opened in a viewer, served, or linked from the site.
* A `/Launch`-flagged file is never listed as "ready", whatever the review tool reports.

## 5. Commands

```
node scripts/recovery/review-launch-pdfs.mjs          # about one minute; read-only; writes migration-output/launch-pdf-review.{json,md}
npx vitest run tests/unit/recovery-launch-targets.test.ts   # the parser, including chunk-boundary and indirect-reference cases
```
