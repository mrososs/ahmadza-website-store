#!/usr/bin/env bash
# AAWRAQ legacy VPS - MINIMAL read-only MariaDB check (AlmaLinux 9 / CyberPanel).
# Answers ONE question set before anything is copied: what state is MariaDB really in, and can its files be trusted as a consistent copy source?
#   process state, version + configuration, data directory, redo/undo layout, is the datadir still CHANGING, backup candidates, encryption.
#
# STRICTLY READ-ONLY. It does not: start, stop, restart, kill or signal anything; change a file, permission or owner; open a database file;
# run a SQL statement; execute anything found on the server; copy or move data; print passwords, keys or other sites' database names.
# Its only interactions with MariaDB are: `systemctl show/status` (state), `ps`/`/proc/<pid>/status` (state), `mariadbd --version` and
# `--print-defaults` (these read the binary / config files and exit; they do NOT start a server), one `mysqladmin ping` with a 5 s timeout, and
# `stat` on a handful of datadir files twice, SAMPLE_SECONDS apart, to see whether anything is still writing to them.
#
# Run (Hostinger Web Console, as root):
#   bash minimal-mariadb-check.sh > /tmp/aawraq-mariadb-check.txt 2>&1
#   less /tmp/aawraq-mariadb-check.txt                      # review it, then paste it back (it is sanitised, but look before sending)
# Tunables: SAMPLE_SECONDS (default 10), MYSQL_DATADIR (default: from the MariaDB config, else /var/lib/mysql), AAWRAQ_HOME_NAME (default aawraq.com)

export LC_ALL=C
SAMPLE_SECONDS="${SAMPLE_SECONDS:-10}"
AAWRAQ_HOME_NAME="${AAWRAQ_HOME_NAME:-aawraq.com}"
LOW="nice -n 19 ionice -c3"; command -v ionice >/dev/null 2>&1 || LOW="nice -n 19"
T="timeout 60"
FLAGS=()
flag() { FLAGS+=("FLAG $1=$2"); }
sec() { echo; echo "=== $* ==="; }

# Output hygiene: credentials, e-mail addresses and the last IPv4 octet are masked; db.table names and paths of OTHER sites are aliased.
sanitize() {
  sed -E \
    -e 's/((pass(word)?|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|salt|authorization)[A-Za-z_]*[=:][ ]*)[^ ,;"'"'"']+/\1<masked>/Ig' \
    -e 's/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]+)/<email>@\1/g' \
    -e "s/'[^']*'@'[^']*'/'<user>'@'<host>'/g" \
    -e 's/`[^`]+`\.`[^`]+`/<db>.<table>/g' \
    -e 's#(\./|/var/lib/mysql/)[A-Za-z0-9_#$.-]+/[A-Za-z0-9_#$.-]+#\1<db>/<table>#g' \
    -e "s#/home/([^/ ]+)#/home/\1#g" \
    -e 's/\b([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\.[0-9]{1,3}\b/\1.x/g' |
  awk -v keep="$AAWRAQ_HOME_NAME" '{ n = split($0, a, "/home/"); out = a[1]; for (i = 2; i <= n; i++) { split(a[i], b, /[\/ \t]/); name = b[1]; rest = substr(a[i], length(name) + 1); out = out "/home/" ((name == keep || name ~ /^aawraq/) ? name : "<other-site>") rest } print out }'
}

main() {

sec "A. MariaDB UNIT and PROCESS STATE (read-only)"
date -u
UNIT=""
for u in mariadb mysql mysqld; do
  ls="$(systemctl show "$u" -p LoadState --value 2>/dev/null)"
  if [ "$ls" = "loaded" ]; then UNIT="$u"; break; fi
done
echo "unit: ${UNIT:-none found}"
if [ -n "$UNIT" ]; then
  systemctl show "$UNIT" -p ActiveState -p SubState -p Result -p MainPID -p ExecMainStatus -p ExecMainCode -p StateChangeTimestamp -p NRestarts -p TimeoutStopUSec -p TimeoutStartUSec 2>&1
  AS="$(systemctl show "$UNIT" -p ActiveState --value 2>/dev/null)"; SS="$(systemctl show "$UNIT" -p SubState --value 2>/dev/null)"
  echo "--- systemctl status (last lines)"; $T systemctl status "$UNIT" --no-pager -l 2>&1 | head -20
  echo "--- journal for the unit (last 25 lines)"; $T journalctl -u "$UNIT" --no-pager -n 25 -o cat 2>&1 | head -30
fi
flag mariadb_active "${AS:-unknown}"
flag mariadb_unit_state "${AS:-unknown}/${SS:-unknown}"

echo "--- mariadbd / mysqld processes"
if command -v pgrep >/dev/null 2>&1; then PIDS="$(pgrep -x mariadbd 2>/dev/null; pgrep -x mysqld 2>/dev/null)"; else PIDS="$(ps -e -o pid=,comm= 2>/dev/null | awk '$2=="mariadbd" || $2=="mysqld" {print $1}')"; fi
DSTATE=0
if [ -z "$PIDS" ]; then echo "no mariadbd/mysqld process"; flag mariadb_process_state none
else
  for p in $PIDS; do
    ps -o pid=,ppid=,stat=,etimes=,wchan:24=,nlwp=,rss= -p "$p" 2>&1 | awk '{print "pid="$1" ppid="$2" stat="$3" age_s="$4" wchan="$5" threads="$6" rss_kb="$7}'
    grep -E '^(State|Threads|VmRSS):' "/proc/$p/status" 2>/dev/null
    d="$(ps -L -o stat= -p "$p" 2>/dev/null | grep -c '^D')"; DSTATE=$((DSTATE + d))
  done
  echo "threads in uninterruptible I/O wait (D state): $DSTATE"
  flag mariadb_process_state "$([ "$DSTATE" -gt 0 ] && echo running_with_D_state_threads || echo running)"
fi
flag mariadb_threads_in_d_state "$DSTATE"
echo "--- does it answer? (one ping, 5 s timeout, socket, no credentials)"
PING="$(timeout 5 mysqladmin ping 2>&1 | head -2)"; echo "$PING"
case "$PING" in *alive*) PS_=alive ;; *denied*) PS_=access_denied ;; *) PS_=no_response ;; esac
flag mariadb_ping "$PS_"

sec "B. VERSION and CONFIGURATION (binary --version and config files only; no server is started)"
BIN="$(command -v mariadbd 2>/dev/null || command -v mysqld 2>/dev/null)"
VER_LINE="$($T "$BIN" --version 2>&1 | grep -E 'Ver [0-9]' | head -1)"; echo "${VER_LINE:-no server binary found}"   # a warning can precede the version line: match the line itself
rpm -q MariaDB-server mariadb-server 2>/dev/null | head -3
VER="$(echo "$VER_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
flag mariadb_version "${VER:-unknown}"
DEFAULTS="$($T "$BIN" --print-defaults 2>/dev/null | tr ' ' '\n')"
cfgget() { echo "$DEFAULTS" | grep -E "^--$1=" | tail -1 | cut -d= -f2-; }
echo "--- effective settings from the configuration files (whitelist; nothing else is printed)"
for k in datadir innodb_data_home_dir innodb_data_file_path innodb_log_group_home_dir innodb_log_file_size innodb_undo_directory innodb_undo_tablespaces innodb_page_size innodb_force_recovery innodb_fast_shutdown innodb_flush_log_at_trx_commit innodb_file_per_table log_error log_bin skip_grant_tables character_set_server; do
  v="$(cfgget "$k")"; [ -n "$v" ] && echo "$k=$v"
done
DD="${MYSQL_DATADIR:-$(cfgget datadir)}"; DD="${DD:-/var/lib/mysql}"; DD="${DD%/}"
flag datadir "$DD"
FR="$(cfgget innodb_force_recovery)"; flag force_recovery_in_config "${FR:-none}"
[ -n "$FR" ] && [ "$FR" != "0" ] && echo "NOTE: innodb_force_recovery=$FR is set in the configuration (the server may have been put into forced recovery)"

sec "C. ENCRYPTION (configuration only)"
ENC="$(echo "$DEFAULTS" | grep -iE '^--(innodb_encrypt_(tables|log|temporary_tables)|encrypt_(binlog|tmp_files|tmp_disk_tables)|aria_encrypt_tables|file_key_management[a-z_]*|plugin[-_]load(_add)?)=' | grep -iE 'encrypt|key_management' )"
if [ -n "$ENC" ]; then echo "$ENC" | sed -E 's/(filename|key)=.*/\1=<path hidden>/I'; else echo "no encryption setting in the configuration"; fi
ENC_HINT=no; echo "$ENC" | grep -qiE 'innodb_encrypt_(tables|log)=(1|on|force)|file_key_management|encrypt_binlog=(1|on)|aria_encrypt_tables=(1|on)' && ENC_HINT=yes
echo "key files present (names only):"; ls -la /etc/mysql/encryption /etc/my.cnf.d/*key* /etc/mysql/*key* 2>/dev/null | head -5
flag encryption_hint "$ENC_HINT"

sec "D. DATA DIRECTORY, REDO / UNDO LAYOUT (names, sizes, dates only)"
echo "datadir: $DD"; ls -ld "$DD" 2>&1
df -h "$DD" 2>&1 | tail -1
echo "--- InnoDB system files"
ls -la --time-style=long-iso "$DD"/ibdata* "$DD"/ib_logfile* "$DD"/ibtmp* "$DD"/ddl_recovery* "$DD"/mysql_upgrade_info 2>/dev/null | awk '{print $1, $5, $6, $7, $8}'
if [ -d "$DD/#innodb_redo" ]; then
  echo "redo layout: MariaDB 10.8+ style, directory #innodb_redo:"; ls -la --time-style=long-iso "$DD/#innodb_redo" 2>/dev/null | awk 'NR>1 {print $5, $6, $7, $8}' | head -12
  flag redo_layout "multi_file_#innodb_redo"
elif ls "$DD"/ib_logfile0 >/dev/null 2>&1; then echo "redo layout: classic ib_logfile0 (+ ib_logfile1 on <=10.4)"; flag redo_layout "classic_ib_logfile"
else echo "redo layout: no redo log file found"; flag redo_layout none; fi
UNDOS="$(ls "$DD"/undo* 2>/dev/null | wc -l)"
echo "undo tablespaces as separate files in the datadir: $UNDOS (0 means the undo log lives inside ibdata1)"
flag undo_layout "$([ "$UNDOS" -gt 0 ] && echo "separate_undo_files_$UNDOS" || echo in_ibdata1)"
echo "--- is anything still writing? stat sampled twice, ${SAMPLE_SECONDS}s apart (size and mtime of the files that change first)"
snap() { for f in "$DD"/ibdata1 "$DD"/ib_logfile0 "$DD"/#innodb_redo/ib_redo* "$DD"/undo00* "$DD"/aria_log.* "$DD"/ddl_recovery.log; do [ -e "$f" ] && stat -c '%n %s %Y' "$f" 2>/dev/null; done | sed -E "s#^$DD/##"; }
S1="$(snap)"; sleep "$SAMPLE_SECONDS"; S2="$(snap)"
echo "$S2" | awk '{print $1, "size="$2, "mtime_epoch="$3}'
NOW="$(date +%s)"; echo "$S2" | awk -v now="$NOW" '{ printf "%s last written %d s ago\n", $1, now - $3 }' | head -8
if [ -z "$S1" ]; then CHG=unknown; elif [ "$S1" = "$S2" ]; then CHG=no; else CHG=yes; fi
echo "datadir files changed during the sample: $CHG"
flag datadir_changing "$CHG"
echo "--- size of the datadir (idle priority, 60 s limit)"
SZ="$($LOW $T du -sm "$DD" 2>/dev/null | cut -f1)"; echo "${SZ:-unknown} MiB"; flag datadir_size_mb "${SZ:-unknown}"
FREE="$(df -Pm "$DD" 2>/dev/null | awk 'NR==2{print $4}')"; flag datadir_fs_free_mb "${FREE:-unknown}"
DBN="$(ls -d "$DD"/*/ 2>/dev/null | wc -l)"; echo "database folders in the datadir: $DBN (names are not printed: other sites live here too)"; flag db_dirs "$DBN"
BF="$(ls "$DD"/*/books.ibd 2>/dev/null | wc -l)"; echo "folders containing a books table file: $BF"; flag books_table_files "$BF"

sec "E. MariaDB ERROR LOG (InnoDB / shutdown / crash lines only, last 40, db.table names and accounts masked)"
LOG="$(cfgget log_error)"; [ -z "$LOG" ] || [ "$LOG" = "stderr" ] && LOG="$(ls -t "$DD"/*.err /var/log/mariadb/*.log /var/log/mysql*/*.log 2>/dev/null | head -1)"
if [ -n "$LOG" ] && [ -r "$LOG" ]; then
  ls -la --time-style=long-iso "$LOG" 2>/dev/null | awk '{print "size", $5, "modified", $6, $7}'
  tail -n 600 "$LOG" 2>/dev/null | grep -iE 'InnoDB|shutdown|crash|signal|abort|recovery|redo|undo|encrypt|corrupt|ready for connections|starting|\[ERROR\]|no space' | tail -40
else echo "no readable error log found"; fi

sec "F. BACKUP CANDIDATES and SNAPSHOT POSSIBILITIES (paths, sizes, dates only; nothing is opened or copied)"
echo "--- files that look like dumps / database backups (>1 MB), newest last"
$LOW $T find /backup /home /var/backups /root /opt /mnt /srv -xdev -type f \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.sql.zst' -o -name '*.sql.bz2' -o -name '*.dump' -o -name '*.bak' -o -name '*mariabackup*' -o -name '*xtrabackup*' \) -size +1M -printf '%s bytes\t%TY-%Tm-%Td\t%p\n' 2>/dev/null | sort -t$'\t' -k2 | tail -25
NDUMP="$($LOW $T find /backup /home /var/backups /root /opt /mnt /srv -xdev -type f \( -name '*.sql' -o -name '*.sql.gz' -o -name '*.sql.zst' -o -name '*.sql.bz2' -o -name '*.dump' -o -name '*.bak' \) -size +1M 2>/dev/null | wc -l)"
flag dump_candidates "$NDUMP"
echo "--- site / panel backup archives (>5 MB), newest last"
$LOW $T find /backup /home/*/backup /var/backups /root /home/aawraq_transfer -xdev -maxdepth 3 -type f \( -name '*.tar' -o -name '*.tar.gz' -o -name '*.tgz' -o -name '*.zip' -o -name '*.7z' \) -size +5M -printf '%s bytes\t%TY-%Tm-%Td\t%p\n' 2>/dev/null | sort -t$'\t' -k2 | tail -25
echo "--- is a consistent snapshot possible ON THE SERVER? (storage layout, read-only listings)"
findmnt -no TARGET,SOURCE,FSTYPE,SIZE,USED "$DD" 2>&1 | head -2
lsblk -f 2>&1 | head -14
if command -v lvs >/dev/null 2>&1; then lvs 2>&1 | head -8; vgs 2>&1 | head -4; VGF="$(vgs --noheadings --units m -o vg_free 2>/dev/null | head -1 | tr -d ' m')"; else echo "lvm tools not installed"; VGF=none; fi
flag lvm_free_mb "${VGF:-unknown}"
for fs in btrfs zfs xfs; do grep -qE "^[^ ]+ [^ ]+ $fs " /proc/mounts 2>/dev/null && echo "filesystem in use: $fs"; done
echo "NOTE: a provider-level snapshot or backup (Hostinger hPanel) cannot be seen from inside the VPS; check it in hPanel and with Hostinger support."

sec "G. SUMMARY FLAGS (machine-readable: scripts/vps/classify-inspection.mjs reads them)"
for f in "${FLAGS[@]}"; do echo "$f"; done
echo
echo "READ THIS: a unit in 'deactivating' (or 'activating'), threads in D state, or datadir_changing=yes means the files are NOT a consistent copy source."
echo "Do not copy the datadir and call it a backup. Do not restart, kill or signal MariaDB. Do not restore a Hostinger backup over this server."
}

main 2>&1 | sanitize
