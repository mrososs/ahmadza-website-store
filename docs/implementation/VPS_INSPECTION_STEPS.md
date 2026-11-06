# Read-only VPS inspection — exact steps (Hostinger Web Console, AlmaLinux 9)

You need: WinSCP (already working for you) and the Hostinger **Web Console** (browser terminal, root). You will **not** share any password or key with anyone: the script never asks for one, and the output it produces is sanitised.

## What it does and does not do
* Reads: system and service state, directory sizes and listings, file **names, sizes, dates, permissions**, MariaDB data-directory table-file names, the tail of the MariaDB error log, backup/dump/archive **names**, suspicious-file **names**.
* Never: modifies, moves, deletes, `chmod`s, restarts or starts anything; opens archives or databases; connects to MariaDB with credentials; executes any file it finds; prints `.env` values (only the key names and eight non-secret settings), password hashes or keys.
* The **only** things it writes are the output file(s) you name in the command (and, optionally, one manifest file). It runs at low CPU/IO priority (`nice`, `ionice`).
* Tested: against a simulated server on Linux (Ubuntu) with the tree mounted **read-only** (no write attempt was possible or made), and its masking was tested with and without `perl`. It has **not** been run on your real server — that is what these steps are for.
* One caution for evidence: two checks read upload files (`grep` for PHP tags and webshell patterns), which can update those files' *access times*. If you want zero touching, add `NO_CONTENT_SCAN=1` to the run command below; everything else still works (only the PHP-tag / webshell checks are skipped).

## Step 1 — put the script on the server (WinSCP)
1. On your PC the file is `D:\mostqel\ahmadza-web-store\new-platform\scripts\vps\readonly-inspect.sh`. Print its fingerprint in PowerShell and keep it:
   ```powershell
   Get-FileHash -Algorithm SHA256 D:\mostqel\ahmadza-web-store\new-platform\scripts\vps\readonly-inspect.sh
   ```
   (The agent gives you the expected value in chat; they must match.)
2. In WinSCP open the server, create a new folder `/root/aawraq-inspect` and upload the file into it. **Set the transfer mode to Binary** (Preferences → Transfer → Transfer mode: *Binary*), otherwise Windows line endings can break the script.

## Step 2 — verify and run (Web Console, as root) — copy each block as one paste
```bash
cd /root/aawraq-inspect
sha256sum readonly-inspect.sh        # must equal the PC fingerprint from Step 1 (lower-case vs upper-case does not matter)
file readonly-inspect.sh             # must NOT say "with CRLF line terminators" (if "file: command not found", skip this line; the hash check already proves the bytes)
bash -n readonly-inspect.sh && echo SYNTAX_OK     # parse only, runs nothing
```
If all three are right, run it **in the background** so a browser disconnect cannot interrupt it:
```bash
cd /root/aawraq-inspect
nohup bash ./readonly-inspect.sh > aawraq-inspect.txt 2>&1 &
echo started
```
(Zero-touch variant: `NO_CONTENT_SCAN=1 nohup bash ./readonly-inspect.sh > aawraq-inspect.txt 2>&1 &`.)
Check progress any time — it is finished when the last line is `=== END ===`:
```bash
tail -n 3 /root/aawraq-inspect/aawraq-inspect.txt
```
Expect roughly 5–20 minutes on a 23 GB site (it walks the filesystem at idle priority). It is safe to press Ctrl+C or close the console; nothing it does needs cleaning up.

## Step 3 — optional file manifest (only if section 3 shows media folders)
This produces a list of every media file (path, size, date) so the agent can compare it with the recovered archive and find the missing covers/images. It writes one extra file.
```bash
cd /root/aawraq-inspect
nohup env MANIFEST=/root/aawraq-inspect/aawraq-manifest.tsv bash ./readonly-inspect.sh > aawraq-inspect2.txt 2>&1 &
```
Add `HASH=1` after `env` to include SHA-256 per file (reads ~6.6 GB at idle priority; slower, but lets the agent verify integrity file by file).

## Step 4 — bring the results to this PC (WinSCP) — do not paste them anywhere
Download `aawraq-inspect.txt` (and `aawraq-manifest.tsv` if made) into a **new folder outside the repository**:
`D:\mostqel\vps-inspection\`
Open the `.txt` in an editor and read it once. It is sanitised, but it contains your server's host name and directory layout, so it must not be committed or posted publicly. Then tell the agent "inspection ready": it reads the files from that folder and runs `node scripts/vps/classify-inspection.mjs D:\mostqel\vps-inspection\aawraq-inspect.txt`.

## Step 5 — afterwards (optional)
`rm -r /root/aawraq-inspect` removes the script and outputs from the server. Nothing else was created.

## Which part of the report answers which question
| You want to know | Report section |
|---|---|
| The original MariaDB database and whether its data files survive | **4** ("ALL non-system databases in the datadir" + table-file sizes for `books`, `book_media`, `users`, `orders`…) and the `FLAG books_table_file` line in **9** |
| Whether a physical-file recovery is possible at all: MariaDB **version**, server configuration, **encryption** settings, the InnoDB system files (`ibdata1`, redo/undo logs) and the datadir size | **4** ("MariaDB version and the settings that decide whether a file-level copy can be recovered on another machine") and the `FLAG mariadb_version`, `encryption_hint`, `datadir_size_mb`, `ib_system_files` lines in **9** |
| Existing SQL dumps and database backups | **4** ("dump / backup candidates", CyberPanel/provider backup folders, cron jobs) |
| Application backup archives | **4** ("application / site backup archives" over 5 MB with their type, "Laravel / CyberPanel backup folders") |
| Missing covers and media | **3** (per-folder file counts, extensions, date ranges for `product_media`, `product_cover`, `category`, `maker`, `article`, `logo`, `request`, `withdraw`, `comment`, `editor`) + the manifest from Step 3 |
| What is actually inside `/home/aawraq.com` | **2** (two-level listing with owner/size/date, two-level sizes, web-root top level, Laravel markers, `.env` key names) |
| Where the disk goes | **4b** (largest folders, files over 200 MB, inodes, logs and journal) and **2** |
| MariaDB health, without restarting | **1** (service state, socket `ping`) and **4** ("MariaDB health WITHOUT restarting": unit state/restarts, stuck-process flags, free space, pid/socket files, InnoDB/crash lines from the error log) |
| Security concerns that would block a new file service | **5** (script-like files and PHP tags in uploads, webshell patterns, recent code changes), **6** (accounts, keys, logins, failed SSH, processes, SUID, world-writable dirs, TLS, vhost, PHP limits), **6b** (SELinux, runtimes, memory, packages, exposed ports) |
| One-screen summary | **9** (machine-readable `FLAG` lines) |

## If something looks wrong
Stop and tell the agent, with the exact text of the message, if: the hashes differ; `bash -n` complains; the console asks for a password; or the report shows an unknown account, key, process or listening port. Do not retry with other commands, and do not restart MariaDB, CyberPanel or the server.
