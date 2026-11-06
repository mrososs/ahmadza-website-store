# VPS inspection scripts: complete change record

Status: for owner review BEFORE anything is run on the VPS. Nothing here has been run on the production server. This repository has no VPS access.

Two scripts exist. Both are read-only; only the minimal one is needed first.

| Script | Purpose | When to run |
|---|---|---|
| `scripts/vps/minimal-mariadb-check.sh` (NEW) | MariaDB process state, version and configuration, data directory, redo/undo layout, whether the files are still changing, backup candidates, encryption | FIRST. It is small, light and answers the safety question |
| `scripts/vps/readonly-inspect.sh` | Whole-host picture: sites, media, uploads, security signals, disk usage | Only after the minimal check shows MariaDB is not in a stuck I/O state. It walks the whole filesystem (`du`, `find`) and reads some files |

## 1. Verify that the file you run is the file reviewed here

On the server, before running anything:

```
sha256sum minimal-mariadb-check.sh readonly-inspect.sh
```

| File | SHA-256 |
|---|---|
| minimal-mariadb-check.sh | `873218aa74a51757f5d2b04dfea11fd863785cd8714942c1b836b5074e42b8cd` |
| readonly-inspect.sh (current) | `d6fcfea7d49dfe9f02faaefd1c29fec7f42ec74184a6e34e9db812cb0e0cc5bb` |

If a hash differs, do not run the file: the copy was altered or truncated in transit. Files must keep Unix (LF) line endings; the repository pins `*.sh` to LF in `.gitattributes`. Upload with WinSCP in binary mode.

## 2. Versions of readonly-inspect.sh

| Version | Commit | Lines | SHA-256 |
|---|---|---|---|
| first | bac2d1a | 166 | `b79fff136f12481e940199f3a9df61505394b8fc1dfaa39edf37308705fa631d` |
| earlier reviewed | 49caf34 | 239 | `07c047e96f1fc65c57a2d2c17d33b3d6adecbc11cc628e56851a1ce4eb81280e` |
| committed after review | a3e414e | 255 | `3648413ccab70882e7d4da8bf58c81a1248e5d3e3b3ebe3df21ca858f9f29331` |
| current (working tree) | uncommitted at time of writing | 255 | `d6fcfea7d49dfe9f02faaefd1c29fec7f42ec74184a6e34e9db812cb0e0cc5bb` |

The version you reviewed earlier is taken to be 49caf34 (the one whose hash starts 07c047e9). If you reviewed a different one, section 4 gives the diff against the very first version, which covers every change ever made.

## 3. What changed since the version you reviewed (49caf34 to current): 16 added lines, nothing removed

All additions are inside section 4 (database) and the summary flags. Each is read-only:

| Added | What it does | Why it cannot change anything |
|---|---|---|
| `rpm -qa \| grep -iE '^(mariadb\|mysql)'` | lists installed MariaDB packages | package database read |
| `mariadbd --version \|\| mysqld --version` piped through `grep -E 'Ver [0-9]'` | prints the exact server version | the binary prints its version and exits; it does not start a server. The `grep` was tightened in this change so that a warning line printed first can no longer be mistaken for the version |
| `grep -hvE ... /etc/my.cnf /etc/my.cnf.d/*.cnf \| head -80` | prints the MariaDB configuration without comments | reads config files; secrets are masked by the sanitiser |
| `grep -rqiE 'file_key_management\|innodb[_-]encrypt\|...' /etc/my.cnf /etc/my.cnf.d` | detects encryption settings | reads config files |
| `ls -la --time-style=long-iso "$DD"/ibdata* ... \| awk` | name, size and date of the InnoDB system files | directory listing only |
| `echo "FLAG mariadb_version / encryption_hint / datadir_size_mb / ib_system_files"` | machine-readable summary | `du -sm` at idle priority and `ls` only |

Operational caution that is not a code change: section 4b and the summary flags run `du` and `find` over the whole filesystem at idle I/O priority. On a server whose MariaDB has threads stuck in uninterruptible I/O wait, that extra reading could hang the console or add load. Run the minimal check first; if it reports threads in D state or a unit that is not active or inactive, stop and report that instead of running the full script.

## 4. Complete diff against the first version (bac2d1a to current)

Added lines start with `+`, removed lines with `-`. This is the entire change history of the script.

```diff
diff --git a/scripts/vps/readonly-inspect.sh b/scripts/vps/readonly-inspect.sh
index 2c7e0c2..5311b8c 100644
--- a/scripts/vps/readonly-inspect.sh
+++ b/scripts/vps/readonly-inspect.sh
@@ -17,3 +17,4 @@
 #   HASH=1 MANIFEST=/tmp/aawraq-manifest.tsv bash readonly-inspect.sh ...   # adds sha256 (reads ~6.6 GB, runs at idle IO priority)
-# Tunables: AAWRAQ_ROOT (default /home/aawraq.com/public_html), EXTRA_ROOTS (default "/home/aawraq_transfer /root")
+# NO_CONTENT_SCAN=1 -> skip the two grep content scans in section 5 (zero upload files are read; use this to avoid any access-time changes)
+# Tunables: AAWRAQ_ROOT (default /home/aawraq.com/public_html), EXTRA_ROOTS (default "/home/aawraq_transfer /root"), MYSQL_DATADIR (default: from /etc/my.cnf*, else /var/lib/mysql)
 
@@ -24,2 +25,5 @@ EXTRA_ROOTS="${EXTRA_ROOTS:-/home/aawraq_transfer /root}"
 ROOTS="$SITE_HOME $EXTRA_ROOTS"
+CS=1; [ -n "$NO_CONTENT_SCAN" ] && CS=0                     # NO_CONTENT_SCAN=1 skips the two grep content scans (no upload file is read, so no access times can change)
+FS_ROOT="${FS_ROOT:-/}"                                              # tunable for a partial scan; default is the whole filesystem
+SCAN_ROOTS="${SCAN_ROOTS:-/home /root /var/backups /backup /opt /mnt /tmp /srv}"
 LOW="nice -n 19 ionice -c3"
@@ -34,3 +38,6 @@ sanitize() {
     sed -E "$f" | perl -pe 's/\b(?!0\.0\.0\.0\b|127\.0\.0\.1\b)(\d+\.\d+\.\d+)\.\d+\b/$1.x/g'
-  else sed -E "$f"; fi
+  else
+    # no perl on this host: still mask the last octet of every IPv4 address (this also turns 127.0.0.1 into 127.0.0.x; acceptable)
+    sed -E "$f" | sed -E 's/\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\.[0-9]{1,3}\b/\1.x/g'
+  fi
 }
@@ -73,2 +80,5 @@ echo "--- sizes (depth 1)"; $LOW du -h --max-depth=1 -x "$SITE_HOME" 2>/dev/null
 [ -d "$AAWRAQ_ROOT" ] && $LOW du -h --max-depth=2 -x "$AAWRAQ_ROOT/storage" "$AAWRAQ_ROOT/public/uploads" 2>/dev/null | sort -h | tail -20
+echo "--- everything inside $SITE_HOME, two levels deep (type perms owner bytes date path; capped at 200)"
+find "$SITE_HOME" -xdev -mindepth 1 -maxdepth 2 -printf '%y %M %u %s %TY-%Tm-%Td %P\n' 2>/dev/null | sort -k6 | head -200
+echo "--- sizes inside $SITE_HOME, two levels deep (largest 40)"; $LOW du -h --max-depth=2 -x "$SITE_HOME" 2>/dev/null | sort -h | tail -40
 
@@ -88,7 +98,15 @@ sec "4. DATABASE AND BACKUPS (names/sizes/dates only)"
 echo "--- dump / backup candidates"
-find / -xdev \( -path /proc -o -path /sys -o -path /usr -o -path /var/lib/mysql -o -path '*/vendor' -o -path '*/node_modules' \) -prune -o -type f \
+DUMPS=$(find "$FS_ROOT" -xdev \( -path /proc -o -path /sys -o -path /usr -o -path /var/lib/mysql -o -path '*/vendor' -o -path '*/node_modules' \) -prune -o -type f \
   \( -iname '*.sql' -o -iname '*.sql.gz' -o -iname '*.sql.bz2' -o -iname '*.sql.zip' -o -iname '*.dump' -o -iname '*.bak' -o -iname '*aawraq*.gz' -o -iname '*aawraq*.zip' -o -iname 'backup*' \) \
-  -size +20k -printf '%p  %s bytes  %TY-%Tm-%Td\n' 2>/dev/null | head -60
+  -size +20k -printf '%p  %s bytes  %TY-%Tm-%Td\n' 2>/dev/null | head -60); printf '%s
+' "$DUMPS"
 echo "--- CyberPanel / provider backup directories"
 ls -la /home/backup /backup /home/cyberpanel/backups "$SITE_HOME/backup" /var/backups 2>&1 | head -40
+echo "--- application / site backup archives (zip, tar*, 7z, xz, zst, rar) over 5 MB in readable locations (size, date, path)"
+ARCH=$(find $SCAN_ROOTS -xdev -type f \( -iname '*.zip' -o -iname '*.tar' -o -iname '*.tar.*' -o -iname '*.tgz' -o -iname '*.7z' -o -iname '*.rar' -o -iname '*.xz' -o -iname '*.zst' \) -size +5M "${PRUNE[@]}" -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null | sort -rn | head -40)
+printf '%s\n' "$ARCH" | awk -F'\t' 'NF==3{printf "%12d bytes  %s  %s\n",$1,$2,$3}'
+echo "--- Laravel / CyberPanel backup folders (type size date path)"
+find "$AAWRAQ_ROOT/storage/app" /home/*/backup /home/cyberpanel /home/backup /backup -maxdepth 3 -iname '*backup*' -printf '%y %s %TY-%Tm-%Td %p\n' 2>/dev/null | head -40
+echo "--- file type of the 10 largest archives above (reads only the first bytes; nothing is opened or extracted)"
+if command -v file >/dev/null 2>&1; then printf '%s\n' "$ARCH" | head -10 | awk -F'\t' 'NF==3{print $3}' | while read -r p; do printf '%s: ' "$p"; file -b "$p" 2>/dev/null | cut -c1-90; done; else echo "(file(1) not installed)"; fi
 echo "--- scheduled jobs (commands sanitised)"
@@ -96,3 +114,3 @@ crontab -l 2>&1 | grep -v '^#' | head -20; ls -la /etc/cron.d 2>/dev/null | head
 echo "--- MariaDB datadir (names only)"
-DD=$(grep -rhE '^\s*datadir' /etc/my.cnf /etc/my.cnf.d 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' '); DD="${DD:-/var/lib/mysql}"; echo "datadir=$DD"
+DD=$(grep -rhE '^\s*datadir' /etc/my.cnf /etc/my.cnf.d 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' '); DD="${DD:-/var/lib/mysql}"; DD="${MYSQL_DATADIR:-$DD}"; echo "datadir=$DD"
 $LOW du -sh "$DD" 2>/dev/null; ls -la "$DD" 2>/dev/null | awk '{print $1,$5,$6,$7,$9}' | head -40
@@ -103,2 +121,14 @@ if [ -n "$DB" ] && [ -d "$DD/$DB" ]; then
 fi
+echo "--- ALL non-system databases in the datadir (does the AAWRAQ data survive?)"
+DB_DIRS=0; BOOKS_FILE=""
+for d in "$DD"/*/; do
+  n=$(basename "$d")
+  case "$n" in mysql|performance_schema|sys|information_schema|'#innodb_redo'|'#innodb_temp') continue;; esac
+  DB_DIRS=$((DB_DIRS+1))
+  printf '%s  files=%s  size=%s\n' "$n" "$(ls "$d" 2>/dev/null | wc -l)" "$($LOW du -sh "$d" 2>/dev/null | cut -f1)"
+  for t in books book_media categories makers users orders payments request_books withdraws site_infos affiliates; do
+    f=$(ls "$d$t".ibd "$d$t".MYD 2>/dev/null | head -1)
+    if [ -n "$f" ]; then printf '    table file %-14s %s bytes\n' "$t" "$(stat -c %s "$f")"; [ "$t" = books ] && BOOKS_FILE="$n/$t:$(stat -c %s "$f")"; fi
+  done
+done
 echo "--- MariaDB error log tail (last 30 lines)"
@@ -106,2 +136,29 @@ for f in "$DD"/*.err /var/log/mariadb/mariadb.log /var/log/mysqld.log; do [ -r "
 echo "--- journal (mariadb, last 25)"; $T journalctl -u mariadb -n 25 --no-pager 2>&1 | tail -25
+echo "--- MariaDB health WITHOUT restarting anything (state only)"
+systemctl show mariadb -p ActiveState -p SubState -p Result -p NRestarts -p MainPID -p ExecMainStartTimestamp 2>&1 | head -8
+ps -eo pid,stat,etime,pcpu,pmem,comm 2>/dev/null | awk 'NR==1 || /mysql|maria/' | head -6
+echo "  (STAT D = stuck waiting on disk, Z = zombie, no mysqld/mariadbd row = not running)"
+df -h "$DD" 2>/dev/null | tail -1; df -i "$DD" 2>/dev/null | tail -1
+ls -la "$DD"/*.pid "$DD"/*.sock /run/mariadb /var/run/mysqld 2>&1 | head -10
+echo "  InnoDB / recovery / corruption lines in the error log (last 20):"
+for f in "$DD"/*.err /var/log/mariadb/mariadb.log /var/log/mysqld.log; do [ -r "$f" ] && { grep -iE 'innodb|crash|corrupt|recover|abort|disk full|no space|error' "$f" | tail -n 20; break; }; done
+echo "--- MariaDB version and the settings that decide whether a file-level copy can be recovered on another machine (state only)"
+rpm -qa 2>/dev/null | grep -iE '^(mariadb|mysql)' | head -8
+MDB_VER_LINE=$( (mariadbd --version || mysqld --version) 2>&1 | grep -E 'Ver [0-9]' | head -1 )   # prints the version and exits; it does NOT start a server
+echo "$MDB_VER_LINE"
+MDB_VER=$(printf '%s' "$MDB_VER_LINE" | grep -oE 'Ver [0-9]+\.[0-9]+\.[0-9]+' | head -1 | cut -d' ' -f2)
+echo "--- server configuration files (comments and blank lines removed; secrets are masked by the sanitiser)"
+grep -hvE '^[[:space:]]*(#|;|$)' /etc/my.cnf /etc/my.cnf.d/*.cnf 2>/dev/null | head -80
+echo "--- encryption indicators (encrypted tablespaces cannot be read on another machine without the key files)"
+ENC_HINT=no
+if grep -rqiE 'file_key_management|innodb[_-]encrypt|encrypt[_-]tables|encrypt[_-]log|aria[_-]encrypt|key_management' /etc/my.cnf /etc/my.cnf.d 2>/dev/null; then ENC_HINT=yes; grep -rniE 'file_key_management|innodb[_-]encrypt|encrypt[_-]tables|encrypt[_-]log|aria[_-]encrypt|key_management' /etc/my.cnf /etc/my.cnf.d 2>/dev/null | head -8; else echo "none found in /etc/my.cnf*"; fi
+echo "--- InnoDB system files in the datadir (name, size, mtime): these must be copied together with the .ibd files"
+ls -la --time-style=long-iso "$DD"/ibdata* "$DD"/ib_logfile* "$DD"/undo* "$DD"/ibtmp* "$DD"/aria_log* "$DD"/ddl_recovery* "$DD"/mysql_upgrade_info 2>/dev/null | awk '{print $5, $6, $7, $8}' | head -20
+
+sec "4b. WHERE THE DISK GOES"
+df -h -x tmpfs -x devtmpfs | head -8; df -i -x tmpfs -x devtmpfs | head -6
+echo "--- largest consumers, two levels deep across the filesystem (nice + idle IO)"; $LOW du -xh --max-depth=2 "$FS_ROOT" 2>/dev/null | sort -h | tail -30
+echo "--- files over 200 MB (largest 30: size, date, path)"
+find "$FS_ROOT" -xdev -type f -size +200M -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null | sort -rn | head -30 | awk -F'\t' '{printf "%12d bytes  %s  %s\n",$1,$2,$3}'
+echo "--- logs and journal"; $LOW du -sh /var/log /home/*/logs /usr/local/lsws/logs 2>/dev/null; journalctl --disk-usage 2>&1 | head -1
 
@@ -115,3 +172,3 @@ find "$AAWRAQ_ROOT/storage/app" "$AAWRAQ_ROOT/public/uploads" -xdev -type f -per
 echo "--- files in uploads whose first bytes contain a PHP open tag (names only)"
-find "$AAWRAQ_ROOT/public/uploads" "$AAWRAQ_ROOT/storage/app" -xdev -type f -size -2M 2>/dev/null | head -5000 | xargs -r -d '\n' grep -lIE '<\?php|<\?=' 2>/dev/null | head -50
+[ "$CS" = 1 ] && find "$AAWRAQ_ROOT/public/uploads" "$AAWRAQ_ROOT/storage/app" -xdev -type f -size -2M 2>/dev/null | head -5000 | xargs -r -d '\n' grep -lIE '<\?php|<\?=' 2>/dev/null | head -50 || echo "(content scan skipped: NO_CONTENT_SCAN is set)"
 echo "--- tiny image files (probe/polyglot candidates), count only"
@@ -121,3 +178,3 @@ find "$AAWRAQ_ROOT" -xdev -type f \( -name '*.php' -o -name '.htaccess' -o -name
 echo "--- webshell-style function patterns in app/public code (names only)"
-grep -rIlE 'eval\(\s*(base64_decode|gzinflate|str_rot13)|FilesMan|c99shell|r57shell|assert\(\s*\$_(POST|GET|REQUEST)|preg_replace\(.*/e' "$AAWRAQ_ROOT/app" "$AAWRAQ_ROOT/public" "$AAWRAQ_ROOT/routes" "$AAWRAQ_ROOT/bootstrap" 2>/dev/null | head -30
+[ "$CS" = 1 ] && grep -rIlE 'eval\(\s*(base64_decode|gzinflate|str_rot13)|FilesMan|c99shell|r57shell|assert\(\s*\$_(POST|GET|REQUEST)|preg_replace\(.*/e' "$AAWRAQ_ROOT/app" "$AAWRAQ_ROOT/public" "$AAWRAQ_ROOT/routes" "$AAWRAQ_ROOT/bootstrap" 2>/dev/null | head -30 || echo "(content scan skipped: NO_CONTENT_SCAN is set)"
 echo "--- upload folder .htaccess / OpenLiteSpeed rules"
@@ -137,3 +194,3 @@ $T journalctl -u sshd --since '30 days ago' --no-pager 2>/dev/null | grep 'Accep
 echo "--- top CPU processes (command name only)"; ps -eo user,pid,pcpu,pmem,etime,comm --sort=-pcpu | head -10
-echo "--- SUID files outside system paths"; find / -xdev -type f -perm -4000 -not -path '/usr/*' -not -path '/proc/*' 2>/dev/null | head -10
+echo "--- SUID files outside system paths"; find "$FS_ROOT" -xdev -type f -perm -4000 -not -path '/usr/*' -not -path '/proc/*' 2>/dev/null | head -10
 echo "--- world-writable dirs inside the site"; find "$SITE_HOME" -xdev -type d -perm -0002 2>/dev/null | head -10
@@ -149,2 +206,10 @@ P=$(ls /usr/local/lsws/lsphp*/bin/php 2>/dev/null | tail -1); [ -n "$P" ] && $T
 
+
+sec "6b. PREREQUISITES AND RISKS FOR A NEW FILE SERVICE ON THIS HOST (state only)"
+echo "SELinux: $(getenforce 2>&1)"; command -v node >/dev/null 2>&1 && echo "node: $(node -v)" || echo "node: not installed"; command -v python3 >/dev/null 2>&1 && python3 --version
+free -m | head -2; echo "cpus: $(nproc)"; systemctl --version 2>/dev/null | head -1
+echo "--- most recent package changes (rpm install dates)"; rpm -qa --last 2>/dev/null | head -8
+echo "--- kernel / last boot"; uname -r; who -b 2>/dev/null
+echo "--- OpenLiteSpeed external apps / proxy definitions (names only)"; grep -E '^\s*(extprocessor|type|address)\b' /usr/local/lsws/conf/httpd_config.conf 2>/dev/null | head -20
+echo "--- ports listening on non-loopback addresses (each one is exposure)"; ss -tlnH 2>/dev/null | awk '$4 !~ /^127\./ && $4 !~ /^\[::1\]/ {print $4}' | sort -u | head -20
 if [ -n "$MANIFEST" ]; then
@@ -162,2 +227,26 @@ sec "8. NOT CHECKABLE FROM INSIDE THE VPS (do in hPanel)"
 echo "Hostinger hPanel -> VPS -> Backups & Snapshots: list available snapshots/backups with dates (do NOT restore over this server)."
+
+sec "9. QUICK FLAGS (machine-readable; used by scripts/vps/classify-inspection.mjs — details are in the sections above)"
+n_script=$(find "$AAWRAQ_ROOT/storage" "$AAWRAQ_ROOT/public/uploads" -xdev \( -type f -o -type l \) \( -iname '*.php*' -o -iname '*.phtml' -o -iname '*.phar' -o -iname '*.sh' -o -iname '*.pl' -o -iname '*.py' -o -iname '*.cgi' -o -iname '.htaccess' \) 2>/dev/null | wc -l)
+if [ "$CS" = 1 ]; then n_phptag=$(find "$AAWRAQ_ROOT/public/uploads" "$AAWRAQ_ROOT/storage/app" -xdev -type f -size -2M 2>/dev/null | head -5000 | xargs -r -d '\n' grep -lIE '<\?php|<\?=' 2>/dev/null | wc -l); else n_phptag="skipped"; fi
+n_uid0=$(awk -F: '$3==0' /etc/passwd | wc -l)
+n_dumps=$(printf '%s\n' "$DUMPS" | grep -c .)
+n_arch=$(printf '%s\n' "$ARCH" | grep -c .)
+n_media=$(find "$AAWRAQ_ROOT/storage/app/public/product_media" -type f 2>/dev/null | wc -l)
+echo "FLAG env_present=$([ -r "$AAWRAQ_ROOT/.env" ] && echo yes || echo no)"
+MA=$(systemctl is-active mariadb 2>/dev/null | head -1); echo "FLAG mariadb_active=${MA:-unknown}"
+MP=$($T mysqladmin ping 2>/dev/null | head -1 | tr ' ' '_' | cut -c1-40); echo "FLAG mariadb_ping=${MP:-no_response}"
+echo "FLAG datadir=$DD"
+echo "FLAG mariadb_version=${MDB_VER:-unknown}"
+echo "FLAG encryption_hint=${ENC_HINT:-unknown}"
+echo "FLAG datadir_size_mb=$($LOW du -sm "$DD" 2>/dev/null | cut -f1)"
+echo "FLAG ib_system_files=$(ls "$DD"/ibdata1 "$DD"/ib_logfile0 2>/dev/null | wc -l)"
+echo "FLAG db_dirs=$DB_DIRS"
+echo "FLAG books_table_file=${BOOKS_FILE:-none}"
+echo "FLAG dump_candidates=$n_dumps"
+echo "FLAG backup_archives_over_5mb=$n_arch"
+echo "FLAG product_media_files=$n_media"
+echo "FLAG script_like_in_uploads=$n_script"
+echo "FLAG php_tag_in_uploads=$n_phptag"
+echo "FLAG uid0_accounts=$n_uid0"
 echo "=== END ==="
```

## 5. Complete diff against the version you reviewed (49caf34 to current)

```diff
diff --git a/scripts/vps/readonly-inspect.sh b/scripts/vps/readonly-inspect.sh
index cfac236..5311b8c 100644
--- a/scripts/vps/readonly-inspect.sh
+++ b/scripts/vps/readonly-inspect.sh
@@ -143,4 +143,16 @@ ls -la "$DD"/*.pid "$DD"/*.sock /run/mariadb /var/run/mysqld 2>&1 | head -10
 echo "  InnoDB / recovery / corruption lines in the error log (last 20):"
 for f in "$DD"/*.err /var/log/mariadb/mariadb.log /var/log/mysqld.log; do [ -r "$f" ] && { grep -iE 'innodb|crash|corrupt|recover|abort|disk full|no space|error' "$f" | tail -n 20; break; }; done
+echo "--- MariaDB version and the settings that decide whether a file-level copy can be recovered on another machine (state only)"
+rpm -qa 2>/dev/null | grep -iE '^(mariadb|mysql)' | head -8
+MDB_VER_LINE=$( (mariadbd --version || mysqld --version) 2>&1 | grep -E 'Ver [0-9]' | head -1 )   # prints the version and exits; it does NOT start a server
+echo "$MDB_VER_LINE"
+MDB_VER=$(printf '%s' "$MDB_VER_LINE" | grep -oE 'Ver [0-9]+\.[0-9]+\.[0-9]+' | head -1 | cut -d' ' -f2)
+echo "--- server configuration files (comments and blank lines removed; secrets are masked by the sanitiser)"
+grep -hvE '^[[:space:]]*(#|;|$)' /etc/my.cnf /etc/my.cnf.d/*.cnf 2>/dev/null | head -80
+echo "--- encryption indicators (encrypted tablespaces cannot be read on another machine without the key files)"
+ENC_HINT=no
+if grep -rqiE 'file_key_management|innodb[_-]encrypt|encrypt[_-]tables|encrypt[_-]log|aria[_-]encrypt|key_management' /etc/my.cnf /etc/my.cnf.d 2>/dev/null; then ENC_HINT=yes; grep -rniE 'file_key_management|innodb[_-]encrypt|encrypt[_-]tables|encrypt[_-]log|aria[_-]encrypt|key_management' /etc/my.cnf /etc/my.cnf.d 2>/dev/null | head -8; else echo "none found in /etc/my.cnf*"; fi
+echo "--- InnoDB system files in the datadir (name, size, mtime): these must be copied together with the .ibd files"
+ls -la --time-style=long-iso "$DD"/ibdata* "$DD"/ib_logfile* "$DD"/undo* "$DD"/ibtmp* "$DD"/aria_log* "$DD"/ddl_recovery* "$DD"/mysql_upgrade_info 2>/dev/null | awk '{print $5, $6, $7, $8}' | head -20
 
 sec "4b. WHERE THE DISK GOES"
@@ -226,4 +238,8 @@ MA=$(systemctl is-active mariadb 2>/dev/null | head -1); echo "FLAG mariadb_acti
 MP=$($T mysqladmin ping 2>/dev/null | head -1 | tr ' ' '_' | cut -c1-40); echo "FLAG mariadb_ping=${MP:-no_response}"
 echo "FLAG datadir=$DD"
+echo "FLAG mariadb_version=${MDB_VER:-unknown}"
+echo "FLAG encryption_hint=${ENC_HINT:-unknown}"
+echo "FLAG datadir_size_mb=$($LOW du -sm "$DD" 2>/dev/null | cut -f1)"
+echo "FLAG ib_system_files=$(ls "$DD"/ibdata1 "$DD"/ib_logfile0 2>/dev/null | wc -l)"
 echo "FLAG db_dirs=$DB_DIRS"
 echo "FLAG books_table_file=${BOOKS_FILE:-none}"
```

## 6. What minimal-mariadb-check.sh runs

Every external command, and why it is safe. Nothing is started, stopped, signalled, written, copied, moved or deleted. No SQL is executed.

| Command | Reads | Notes |
|---|---|---|
| `systemctl show/status <unit>`, `journalctl -u <unit> -n 25` | unit state and the last log lines | state queries only |
| `pgrep` / `ps`, `/proc/<pid>/status` | process state, thread states | no signal is sent |
| `mysqladmin ping` with `timeout 5` | whether the socket answers | the only contact with the server; no credentials; harmless |
| `mariadbd --version`, `mariadbd --print-defaults` | binary version, configured options | both exit immediately; they do not start a server |
| `rpm -q` | installed package versions | |
| `stat` on `ibdata1`, redo files, `undo*`, `aria_log.*`, twice, `SAMPLE_SECONDS` (default 10) apart | size and modification time | tells whether anything is still writing to the datadir. Only metadata is read; no file content |
| `ls`, `df`, `du -sm` (idle priority, 60 s limit), `findmnt`, `lsblk`, `lvs`, `vgs` | names, sizes, storage layout | listings only |
| `find ... -printf` over backup locations | name, size, date of dump and archive candidates | file contents are never opened |
| `tail -n 600` on the error log, filtered to InnoDB, shutdown and crash lines, last 40 | log text | account names, hosts, db.table names, other sites' paths and IP last octets are masked |

Output hygiene: credentials, e-mail addresses, other sites' database names and the last IPv4 octet are masked, other sites' home folders become `<other-site>`, and database folder names are never printed (only a count).

What it deliberately cannot see: provider-level snapshots and backups (check hPanel and ask Hostinger support).

## 7. How to read the result

The last section prints machine-readable `FLAG` lines. Feed both outputs to the classifier on your PC:

```
node scripts/vps/classify-inspection.mjs aawraq-mariadb-check.txt aawraq-inspect.txt
```

The classifier treats the datadir as a consistent copy source only if the unit is stopped (inactive or failed), no `mariadbd`/`mysqld` process exists, no thread is in D state, and the sampled files did not change. Anything else is reported as `B2-UNSAFE`, never recommended, and the advice becomes: use an existing dump, a live table-limited dump if MariaDB answers, or a provider backup restored to a NEW server.
