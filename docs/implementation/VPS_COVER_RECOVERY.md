# Recovering the original book covers from the legacy VPS

Status 2026-11-07. **The original covers are not in the workspace** (checked: both archives, the quarantine, and every cover-like file in the source archive; the source archive holds only theme images and the default cover). They are in `/home/aawraq.com/public_html/storage/app/public/product_cover`. I cannot reach the VPS, so this is the minimum you need to do. Nothing below changes or deletes anything on the server.

## Why a match is possible even without the database

The Laravel code (read from `aawraq-source.tar.gz`, never run) saves a cover as `product_cover/<time()><random><date('Ymdis')>.webp` when a book is created or a contributor request is approved, and a PDF as `product_media/<site>-<time()>.<ext>` on a separate "contents" page. The database column that links them (`books.file`) is in MariaDB, which is not recoverable. So a cover and its PDF are linked only by evidence:

| Result | What it takes | Who decides |
|---|---|---|
| **verified** | the cover and the PDF were saved within 2 seconds, the cover not later, and nothing else competes in that window (the contributor-approval path saves both in one request; an ordinary book needs a page navigation between them) | applied automatically as the book's cover |
| **candidate (strong)** | the cover is visually the same picture as the first page of that book's own PDF | an administrator approves |
| **candidate** | the nearest PDF added after the cover within 48 h with nothing between | an administrator approves |
| **unmatched** | anything else. A similar title is never evidence, and one image is never given to two books | stays unmatched |

Tested on synthetic data (`tests/unit/cover-matching.test.ts`, 22 tests, and an end-to-end run on the local mirror). No cover is ever published as a book's *original* without one of these.

## Step 1: look before copying (read-only)

1. With WinSCP as `aawraq_transfer`, upload `scripts/vps/cover-inspect.sh` to `/home/aawraq_transfer/` in **Binary** mode.
2. In the Hostinger Web Console check it is the file you meant, then run it:
   ```bash
   sha256sum /home/aawraq_transfer/cover-inspect.sh
   # must print:  9edd36355fc874b3871bb14cfc3bb1e72455e90daffb024c8179fe589b55827a
   bash /home/aawraq_transfer/cover-inspect.sh
   ```
   It reads names, sizes, dates and the first bytes of each file. It writes only `/home/aawraq_transfer/cover-inspect/cover-report.txt` and `cover-manifest.tsv`.
3. Download `cover-report.txt` with WinSCP and tell me what it says (file count, total size, how many follow the legacy naming, anything that is not an image). Do not send passwords or keys.

## Step 2: copy the images into a dedicated transfer folder (originals untouched)

In the Hostinger Web Console:

```bash
install -d -m 0750 -o aawraq_transfer -g aawraq_transfer /home/aawraq_transfer/cover-transfer/product_cover
cd /home/aawraq.com/public_html/storage/app/public/product_cover
find . -maxdepth 1 -type f \( -iname '*.webp' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 \
  | xargs -0 cp --no-clobber --preserve=timestamps -t /home/aawraq_transfer/cover-transfer/product_cover/
chown -R aawraq_transfer:aawraq_transfer /home/aawraq_transfer/cover-transfer
find /home/aawraq_transfer/cover-transfer -type f -exec chmod 0640 {} +
( cd /home/aawraq_transfer/cover-transfer && find product_cover -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS.txt )
ls /home/aawraq_transfer/cover-transfer/product_cover | wc -l
```

Why this is safe: the source folder is only read. The destination is a **new** folder in the transfer account's own home. `--no-clobber` never overwrites, `--preserve=timestamps` keeps each file's date (the matching uses it as evidence), only image extensions are copied, and nothing is deleted or moved. It copies no PDF, no private upload and no other part of the site. No root password or SSH key is needed beyond the Web Console you already use.

## Step 3: download with WinSCP (download only)

Create an empty folder `D:\mostqel\aawraq-vps-content\` (outside the repository), then either drag `/home/aawraq_transfer/cover-transfer/` into it, or run this script (`YOUR_SAVED_SESSION` is your existing `aawraq_transfer` session; the script holds no password):

```
option batch abort
option confirm off
open "YOUR_SAVED_SESSION"
lcd D:\mostqel\aawraq-vps-content
option transfer binary
get -preservetime -resume "/home/aawraq_transfer/cover-transfer/*" "D:\mostqel\aawraq-vps-content\"
exit
```

Verify every file arrived intact (PowerShell, in `D:\mostqel\aawraq-vps-content`):

```powershell
Get-Content SHA256SUMS.txt | ForEach-Object { $h, $p = $_ -split '  ', 2; if ((Get-FileHash -Algorithm SHA256 $p).Hash.ToLower() -ne $h) { "MISMATCH $p" } }; "checked"
```

## Step 4 (me): match, review, apply

```
node scripts/recovery/match-covers.mjs --covers D:\mostqel\aawraq-vps-content\product_cover --visual
node scripts/recovery/apply-original-covers.mjs --report migration-output\cover-matches-<time>.json --covers D:\mostqel\aawraq-vps-content\product_cover --confirm ubjuyeccioflhpcpnhmo          # dry run
node scripts/recovery/apply-original-covers.mjs ... --apply
```

* Every file is validated first: a regular file, an image by its first bytes (not its name), 2 MiB at most, sane dimensions, hashed. Anything else is rejected and listed.
* Verified matches become the book's cover (provenance `original_cover`); they may replace a generated first-page cover but never an original or a hand-uploaded one. Candidates wait in a private bucket for an administrator. Unmatched images are never uploaded.
* It never changes a book's status, price or publication. Idempotent. Exact before and after counts are printed.

## The same steps for the other folders

`category`, `maker`, `article` and `logo` are copied the same way (replace `product_cover`). They cannot be attached to categories, authors or articles without the database, but the logo and public article images can be reviewed and used on their own. Never copy `request`, `withdraw`, `comment` or any other private upload.
