#!/usr/bin/env bash
# AAWRAQ legacy VPS — READ-ONLY inspection (AlmaLinux 9 / CyberPanel / OpenLiteSpeed).
#
# What it does NOT do: modify, move, delete, chmod, restart or start anything; execute any file found on the server;
# open archives or databases; print .env values (only a few non-secret keys), password hashes or keys.
# Section 5 pattern-scans upload/code files with grep (read-only matching) but prints only the matching file NAMES, never their bodies.
# What it prints: system/service state, directory sizes + file counts, extension histograms, dates, permissions,
# suspicious-file NAMES, backup candidates (path/size/date), MariaDB datadir table-file names.
# The only writes possible are your own output redirect and, if you set MANIFEST=..., that one manifest file.
# Output is sanitised (credentials, emails, last IPv4 octet masked). Review it before sending it back anyway.
#
# Run (Hostinger Web Console, as root):
#   bash readonly-inspect.sh > /tmp/aawraq-inspect.txt 2>&1      # the only file it creates is this report (your redirect)
#   less /tmp/aawraq-inspect.txt                                  # then download via WinSCP, or paste sections back
# Optional file manifest of media (path, size, mtime[, sha256]) for reconciliation with the recovered archive:
#   MANIFEST=/tmp/aawraq-manifest.tsv bash readonly-inspect.sh > /tmp/aawraq-inspect.txt 2>&1
#   HASH=1 MANIFEST=/tmp/aawraq-manifest.tsv bash readonly-inspect.sh ...   # adds sha256 (reads ~6.6 GB, runs at idle IO priority)
# Tunables: AAWRAQ_ROOT (default /home/aawraq.com/public_html), EXTRA_ROOTS (default "/home/aawraq_transfer /root")

export LC_ALL=C
AAWRAQ_ROOT="${AAWRAQ_ROOT:-/home/aawraq.com/public_html}"
SITE_HOME="$(dirname "$AAWRAQ_ROOT")"
EXTRA_ROOTS="${EXTRA_ROOTS:-/home/aawraq_transfer /root}"
ROOTS="$SITE_HOME $EXTRA_ROOTS"
LOW="nice -n 19 ionice -c3"
command -v ionice >/dev/null 2>&1 || LOW="nice -n 19"
T="timeout 120"
PRUNE=( -not -path '*/vendor/*' -not -path '*/node_modules/*' -not -path '*/proc/*' )

sec() { echo; echo "=== $* ==="; }
sanitize() {
  local f='s/((pass(word)?|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|salt|app_key|authorization)[A-Za-z_]*[=:][ ]*)[^ ,;"'"'"']+/\1<masked>/Ig; s/(-p)[^ ]+/\1<masked>/g; s/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]+)/<email>@\1/g'
  if command -v perl >/dev/null 2>&1; then
    sed -E "$f" | perl -pe 's/\b(?!0\.0\.0\.0\b|127\.0\.0\.1\b)(\d+\.\d+\.\d+)\.\d+\b/$1.x/g'
  else sed -E "$f"; fi
}

main() {
sec "0. HOST"
date -u; hostname; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"; uname -r; uptime
df -hT -x tmpfs -x devtmpfs | head -12; free -m | head -3
echo "whoami: $(whoami)  (read-only run; no changes are made)"

sec "1. SERVICES (state only)"
for s in mariadb mysql lsws lscpd pure-ftpd postfix dovecot firewalld csf lfd fail2ban sshd crond; do
  printf '%-12s %s\n' "$s" "$(systemctl is-active $s 2>&1 | head -1) / enabled=$(systemctl is-enabled $s 2>&1 | head -1)"
done
echo "--- mariadb unit (last status lines)"; $T systemctl status mariadb --no-pager -l 2>&1 | head -25
echo "--- mariadb ping (socket, no credentials)"; $T mysqladmin ping 2>&1 | head -3
echo "--- listening sockets"; ss -tlnpH 2>/dev/null | awk '{print $1, $4, $6}' | sort | head -40
echo "--- firewalld"; $T firewall-cmd --list-all 2>&1 | head -20
echo "--- OpenLiteSpeed"; /usr/local/lsws/bin/lshttpd -v 2>&1 | head -2
ls -d /usr/local/lsws/lsphp*/ 2>/dev/null

sec "2. SITES ON THIS SERVER (names only; others are out of scope)"
ls -la /home | awk '{print $1,$3,$4,$6,$7,$9}' | head -40
echo "--- AAWRAQ site home: $SITE_HOME"
ls -la "$SITE_HOME" 2>&1 | head -30
echo "--- web root top level: $AAWRAQ_ROOT"
ls -la "$AAWRAQ_ROOT" 2>&1 | head -50
echo "--- Laravel markers"
for f in artisan composer.json .env public/index.php bootstrap/app.php; do [ -e "$AAWRAQ_ROOT/$f" ] && echo "present: $f" || echo "absent:  $f"; done
echo "--- .env: KEY NAMES ONLY, plus non-secret values"
if [ -r "$AAWRAQ_ROOT/.env" ]; then
  grep -oE '^[A-Z0-9_]+=' "$AAWRAQ_ROOT/.env" | tr -d '=' | tr '\n' ' '; echo
  grep -E '^(APP_ENV|APP_DEBUG|APP_URL|DB_CONNECTION|DB_HOST|DB_PORT|DB_DATABASE|FILESYSTEM_DRIVER|FILESYSTEM_DISK|QUEUE_CONNECTION|SESSION_DRIVER)=' "$AAWRAQ_ROOT/.env"
  echo ".env mode/owner: $(stat -c '%a %U:%G %y' "$AAWRAQ_ROOT/.env")"
fi
echo "--- is .env or storage reachable from the web? (vhost docRoot + symlink)"
ls -ld "$AAWRAQ_ROOT/public/storage" "$AAWRAQ_ROOT/storage" "$AAWRAQ_ROOT/public/uploads" 2>&1
readlink -f "$AAWRAQ_ROOT/public/storage" 2>&1
echo "--- sizes (depth 1)"; $LOW du -h --max-depth=1 -x "$SITE_HOME" 2>/dev/null | sort -h | tail -15
[ -d "$AAWRAQ_ROOT" ] && $LOW du -h --max-depth=2 -x "$AAWRAQ_ROOT/storage" "$AAWRAQ_ROOT/public/uploads" 2>/dev/null | sort -h | tail -20

sec "3. MEDIA FOLDERS (original book media, covers, branding, requests)"
for name in product_media product_cover category maker article logo request withdraw comment editor; do
  find $ROOTS -xdev -type d -name "$name" "${PRUNE[@]}" 2>/dev/null | head -8 | while read -r d; do
    n=$(find "$d" -type f 2>/dev/null | wc -l); b=$($LOW du -sb "$d" 2>/dev/null | cut -f1)
    echo "[$name] $d  files=$n  bytes=$b"
    find "$d" -type f -printf '%f\n' 2>/dev/null | awk -F. 'NF>1{print tolower($NF)} NF==1{print "(none)"}' | sort | uniq -c | sort -rn | head -8 | sed 's/^/      ext /'
    find "$d" -type f -printf '%TY-%Tm-%Td\n' 2>/dev/null | sort | sed -n '1p;$p' | sed 's/^/      mtime /'
  done
done
echo "--- legacy-named archives that may hold the other folders"
find $ROOTS -xdev -maxdepth 3 -type f \( -name '*.tar' -o -name '*.tar.gz' -o -name '*.tgz' -o -name '*.zip' -o -name '*.7z' \) -printf '%p  %s bytes  %TY-%Tm-%Td\n' 2>/dev/null | head -40

sec "4. DATABASE AND BACKUPS (names/sizes/dates only)"
echo "--- dump / backup candidates"
find / -xdev \( -path /proc -o -path /sys -o -path /usr -o -path /var/lib/mysql -o -path '*/vendor' -o -path '*/node_modules' \) -prune -o -type f \
  \( -iname '*.sql' -o -iname '*.sql.gz' -o -iname '*.sql.bz2' -o -iname '*.sql.zip' -o -iname '*.dump' -o -iname '*.bak' -o -iname '*aawraq*.gz' -o -iname '*aawraq*.zip' -o -iname 'backup*' \) \
  -size +20k -printf '%p  %s bytes  %TY-%Tm-%Td\n' 2>/dev/null | head -60
echo "--- CyberPanel / provider backup directories"
ls -la /home/backup /backup /home/cyberpanel/backups "$SITE_HOME/backup" /var/backups 2>&1 | head -40
echo "--- scheduled jobs (commands sanitised)"
crontab -l 2>&1 | grep -v '^#' | head -20; ls -la /etc/cron.d 2>/dev/null | head; cat /etc/cron.d/* 2>/dev/null | grep -v '^#' | head -20
echo "--- MariaDB datadir (names only)"
DD=$(grep -rhE '^\s*datadir' /etc/my.cnf /etc/my.cnf.d 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' '); DD="${DD:-/var/lib/mysql}"; echo "datadir=$DD"
$LOW du -sh "$DD" 2>/dev/null; ls -la "$DD" 2>/dev/null | awk '{print $1,$5,$6,$7,$9}' | head -40
DB=$(grep -E '^DB_DATABASE=' "$AAWRAQ_ROOT/.env" 2>/dev/null | cut -d= -f2)
if [ -n "$DB" ] && [ -d "$DD/$DB" ]; then
  echo "--- tables of the AAWRAQ database '$DB' (file name, size) — shows whether the data files survive"
  ls -la "$DD/$DB" | awk '{print $5,$9}' | sort -k2 | head -120
fi
echo "--- MariaDB error log tail (last 30 lines)"
for f in "$DD"/*.err /var/log/mariadb/mariadb.log /var/log/mysqld.log; do [ -r "$f" ] && { echo "[$f]"; tail -n 30 "$f"; break; }; done
echo "--- journal (mariadb, last 25)"; $T journalctl -u mariadb -n 25 --no-pager 2>&1 | tail -25

sec "5. FILE INTEGRITY — suspicious artefact NAMES (never contents, never executed)"
echo "--- script-like files inside upload/storage trees (should be ZERO)"
find "$AAWRAQ_ROOT/storage" "$AAWRAQ_ROOT/public/uploads" "$AAWRAQ_ROOT/public/storage" -xdev \( -type f -o -type l \) \
  \( -iname '*.php*' -o -iname '*.phtml' -o -iname '*.phar' -o -iname '*.sh' -o -iname '*.pl' -o -iname '*.py' -o -iname '*.cgi' -o -iname '.htaccess' -o -iname '*.jsp' -o -iname '*.asp*' \) \
  -printf '%p  %s bytes  mode=%m  %u  %TY-%Tm-%Td\n' 2>/dev/null | head -50
echo "--- executable bit on upload files"
find "$AAWRAQ_ROOT/storage/app" "$AAWRAQ_ROOT/public/uploads" -xdev -type f -perm /111 -printf '%p mode=%m\n' 2>/dev/null | head -30
echo "--- files in uploads whose first bytes contain a PHP open tag (names only)"
find "$AAWRAQ_ROOT/public/uploads" "$AAWRAQ_ROOT/storage/app" -xdev -type f -size -2M 2>/dev/null | head -5000 | xargs -r -d '\n' grep -lIE '<\?php|<\?=' 2>/dev/null | head -50
echo "--- tiny image files (probe/polyglot candidates), count only"
find "$AAWRAQ_ROOT/public/uploads" -xdev -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) -size -256c 2>/dev/null | wc -l
echo "--- app code touched in the last 120 days (php/htaccess outside vendor; name+date)"
find "$AAWRAQ_ROOT" -xdev -type f \( -name '*.php' -o -name '.htaccess' -o -name '*.phtml' \) "${PRUNE[@]}" -mtime -120 -printf '%TY-%Tm-%Td %p\n' 2>/dev/null | sort | tail -60
echo "--- webshell-style function patterns in app/public code (names only)"
grep -rIlE 'eval\(\s*(base64_decode|gzinflate|str_rot13)|FilesMan|c99shell|r57shell|assert\(\s*\$_(POST|GET|REQUEST)|preg_replace\(.*/e' "$AAWRAQ_ROOT/app" "$AAWRAQ_ROOT/public" "$AAWRAQ_ROOT/routes" "$AAWRAQ_ROOT/bootstrap" 2>/dev/null | head -30
echo "--- upload folder .htaccess / OpenLiteSpeed rules"
for f in "$AAWRAQ_ROOT/public/.htaccess" "$AAWRAQ_ROOT/public/uploads/.htaccess" "$AAWRAQ_ROOT/.htaccess"; do [ -f "$f" ] && { echo "[$f]"; head -60 "$f"; }; done

sec "6. HOST COMPROMISE INDICATORS (metadata)"
echo "--- UID 0 accounts"; awk -F: '$3==0{print $1}' /etc/passwd
echo "--- login-capable accounts"; getent passwd | awk -F: '$7 !~ /(nologin|false|sync|shutdown|halt)$/ {print $1,$3,$6,$7}'
echo "--- authorized_keys fingerprints (no key bodies)"
for h in /root /home/*; do f="$h/.ssh/authorized_keys"; [ -f "$f" ] && { echo "[$f] mtime=$(stat -c %y "$f" | cut -c1-10)"; ssh-keygen -lf "$f" 2>/dev/null; }; done
echo "--- recent logins"; last -n 15 -i 2>/dev/null | head -15
echo "--- failed SSH logins, last 30 days (count) and top sources"
$T journalctl -u sshd --since '30 days ago' --no-pager 2>/dev/null | grep -c 'Failed password'
$T journalctl -u sshd --since '30 days ago' --no-pager 2>/dev/null | grep 'Failed password' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | sort | uniq -c | sort -rn | head -5
echo "--- accepted SSH logins, last 30 days (user + masked source)"
$T journalctl -u sshd --since '30 days ago' --no-pager 2>/dev/null | grep 'Accepted' | awk '{print $(NF-5), $(NF-3)}' | sort | uniq -c | sort -rn | head -10
echo "--- top CPU processes (command name only)"; ps -eo user,pid,pcpu,pmem,etime,comm --sort=-pcpu | head -10
echo "--- SUID files outside system paths"; find / -xdev -type f -perm -4000 -not -path '/usr/*' -not -path '/proc/*' 2>/dev/null | head -10
echo "--- world-writable dirs inside the site"; find "$SITE_HOME" -xdev -type d -perm -0002 2>/dev/null | head -10
echo "--- user cron files"; ls -la /var/spool/cron 2>/dev/null
echo "--- web access logs present (rotation/size/date only)"
ls -la /home/aawraq.com/logs /usr/local/lsws/logs 2>&1 | awk '{print $5,$6,$7,$9}' | head -25
echo "--- TLS certificate served on 443"
echo | $T openssl s_client -connect 127.0.0.1:443 -servername aawraq.com 2>/dev/null | openssl x509 -noout -subject -issuer -dates 2>&1 | head -4
echo "--- OpenLiteSpeed vhost (docRoot, contexts, rewrite) for aawraq"
for f in /usr/local/lsws/conf/vhosts/aawraq.com/vhost.conf; do [ -r "$f" ] && head -80 "$f"; done
echo "--- PHP limits"
P=$(ls /usr/local/lsws/lsphp*/bin/php 2>/dev/null | tail -1); [ -n "$P" ] && $T "$P" -i 2>/dev/null | grep -E '^(PHP Version|disable_functions|upload_max_filesize|post_max_size|open_basedir|allow_url_include)' | head -8

if [ -n "$MANIFEST" ]; then
  sec "7. MANIFEST -> $MANIFEST (metadata$([ -n "$HASH" ] && echo ' + sha256'))"
  : > "$MANIFEST"
  find "$AAWRAQ_ROOT/storage/app/public" "$AAWRAQ_ROOT/public/uploads" "$SITE_HOME/public_html/public/storage/" -xdev -type f 2>/dev/null | sort -u | while read -r p; do
    s=$(stat -c '%s\t%y' "$p" | cut -c1-40)
    if [ -n "$HASH" ]; then h=$($LOW sha256sum "$p" | cut -d' ' -f1); else h=""; fi
    printf '%s\t%s\t%s\n' "$p" "$s" "$h" >> "$MANIFEST"
  done
  wc -l "$MANIFEST"
fi

sec "8. NOT CHECKABLE FROM INSIDE THE VPS (do in hPanel)"
echo "Hostinger hPanel -> VPS -> Backups & Snapshots: list available snapshots/backups with dates (do NOT restore over this server)."
echo "=== END ==="
}

main 2>&1 | sanitize
