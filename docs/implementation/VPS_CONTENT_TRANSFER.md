# Recovering the five missing VPS folders (covers, categories, authors, articles, logo)

Status 2026-11-07. **For the book covers (`product_cover`) follow `VPS_COVER_RECOVERY.md`, which has the exact commands for the `aawraq_transfer` account and replaces Step 2 below for that folder.** **These folders are not in the recovered workspace.** Checked: neither archive (`aawraq-user-files.tar`, 6.98 GB; `aawraq-source.tar.gz`) nor the quarantine contains `product_cover`, `category`, `maker`, `article` or `logo`. The user-files archive holds only `public/uploads/editor` (editor images and videos) and `storage/app/public/product_media` (the PDFs, already recovered). The names of these folders are known from the earlier inspection; their **content** is not. I have no SSH access and need none: this is a download you make with the WinSCP session you already use.

## What is needed, and what is not

| Folder on the VPS (`/home/aawraq.com/public_html/storage/app/public/…`) | Copy it? |
|---|---|
| `product_cover` | **yes** (book covers) |
| `category` | **yes** (category images) |
| `maker` | **yes** (author and reader photos) |
| `article` | **yes** (blog images) |
| `logo` | **yes** (site branding) |
| `product_media` | **no**: the 1,060 PDFs are already recovered and hashed |
| `request`, `withdraw`, `comment`, `editor` | **no**: private uploads (contributor requests, withdrawal documents) or already recovered. Do not copy them |

Never copy MariaDB's data directory this way (`/var/lib/mysql`): a copy of a live datadir is not a backup (`SAFE_ACQUISITION_PLAN.md`, `INCREMENTAL_RECOVERY_PLAN.md`).

## Step 1 (optional, read-only): see how big it is before copying

In the WinSCP window, select each of the five folders, press **Alt+Enter** (Properties) and **Calculate** the total size, or run the existing read-only inspection with a manifest. The manifest lists `path size` for every file and changes nothing except the one file it writes:

```bash
MANIFEST=/tmp/aawraq-manifest.tsv bash /root/aawraq-inspect/readonly-inspect.sh > /tmp/aawraq-inspect.txt 2>&1
```

(`VPS_INSPECTION_STEPS.md` has the upload, hash-check and download steps for that script.) Download `/tmp/aawraq-manifest.tsv`, put it in `D:\mostqel\vps-inspection\`, and tell me. I compare it with the recovered archive offline: `node scripts/vps/compare-manifest.mjs D:\mostqel\vps-inspection\aawraq-manifest.tsv`.

## Step 2: the download (WinSCP, download direction only)

Create an **empty** folder outside the repository: `D:\mostqel\aawraq-vps-content\`. Save this as `D:\mostqel\copy-vps-content.txt` and run it with the WinSCP you already have (`"C:\Program Files (x86)\WinSCP\WinSCP.com" /script=D:\mostqel\copy-vps-content.txt`). Replace `YOUR_SAVED_SESSION` with the name of the session you normally open; the script holds no password.

```
option batch abort
option confirm off
open "YOUR_SAVED_SESSION"
lcd D:\mostqel\aawraq-vps-content
option transfer binary
get -preservetime -resume "/home/aawraq.com/public_html/storage/app/public/product_cover" "D:\mostqel\aawraq-vps-content\"
get -preservetime -resume "/home/aawraq.com/public_html/storage/app/public/category" "D:\mostqel\aawraq-vps-content\"
get -preservetime -resume "/home/aawraq.com/public_html/storage/app/public/maker" "D:\mostqel\aawraq-vps-content\"
get -preservetime -resume "/home/aawraq.com/public_html/storage/app/public/article" "D:\mostqel\aawraq-vps-content\"
get -preservetime -resume "/home/aawraq.com/public_html/storage/app/public/logo" "D:\mostqel\aawraq-vps-content\"
exit
```

Why this is safe: it uses only `get`. It has no `rm`, `mv`, `put`, `-delete` or synchronise-with-delete, so nothing on the server is changed. Do not use root credentials for it; the account that already reaches `/home/aawraq.com/` is enough. If a file cannot be read, WinSCP stops (`option batch abort`) and tells you which one; send me that line, do not work around it.

The GUI route is equivalent: drag the five folders from the right (server) pane to `D:\mostqel\aawraq-vps-content\`. Do not tick "delete files" in any synchronise dialog.

## Step 3 (me, after the copy): validate, then integrate

1. Hash and inventory every file; refuse anything that is not an image or a plain document by magic bytes, anything with a double extension, any script, SVG with active content, or oversize file. Same pipeline as the PDFs (quarantine, Defender scan, hash).
2. Deduplicate by SHA-256. A file is never overwritten without comparing its hash with the existing one.
3. **Branding (`logo`)** and **public article images (`article`)** can be integrated on their own after you look at them: the logo as the site logo, article images as public media for the blog.
4. **Covers, category and author images cannot be attached to books, categories or authors from the files alone.** Their names are random identifiers, and the legacy tables that say which cover belongs to which book, and which image belongs to which category or author (column names are in `docs/legacy-audit/`), live in the MariaDB database, which is not recoverable yet. I will not guess a match from a title or a file date. They are kept as validated, hashed, unmatched assets and attached the moment a consistent database source exists (`SAFE_ACQUISITION_PLAN.md`). The 127 recovered drafts keep the fallback cover until then (the admin can upload a cover by hand).
5. Safe images go to the public media storage; private PDFs never do. Nothing here publishes a book.

## What to send me

Only this: confirmation that `D:\mostqel\aawraq-vps-content\` is filled (or the WinSCP error line), and, if you made it, the manifest. Not passwords, not keys, not screenshots of credentials.
