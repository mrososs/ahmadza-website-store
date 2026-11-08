#!/bin/bash
# READ-ONLY acquisition of the legacy `articles` table and the article image folder. It NEVER starts, restarts, repairs or modifies MariaDB, never touches its data directory,
# and writes only into the report folder you name. Nothing is printed that contains a password.
#
#   bash articles-acquire.sh [report-dir]          default report-dir: /home/aawraq_transfer/articles-acquire
#
# Needs: the database is ALREADY running (the script refuses to start it). It reads the credentials the legacy app itself uses (DB_* in its .env) into variables and never echoes them.
# Output (send these back, not the credentials):
#   articles.sql.gz          mysqldump of the single table `articles` (--single-transaction: a consistent read, no lock, no write)
#   articles-report.txt      row counts by article_type / status / show_public / soft-deleted, and the id range
#   article-images.tsv       path, bytes, mtime, sha256 of every file in the article image folders (a manifest only; copy the files separately with WinSCP)
set -u
export LC_ALL=C
OUT="${1:-/home/aawraq_transfer/articles-acquire}"
APP="${APP_DIR:-/home/aawraq.com/public_html}"
mkdir -p -- "$OUT" || { echo "cannot create $OUT" >&2; exit 2; }
REPORT="$OUT/articles-report.txt"; : > "$REPORT"

# 1. never start anything: the service must already be up
if ! systemctl is-active --quiet mariadb 2>/dev/null && ! systemctl is-active --quiet mysql 2>/dev/null; then
  echo "MariaDB is not running. This script will NOT start it and will NOT read its data directory." | tee -a "$REPORT"
  echo "Next step: ask Hostinger for a snapshot restored to a NEW, separate server and run this script there (see docs/implementation/ARTICLES_AND_READER_REPORT.md section 5)." | tee -a "$REPORT"
  exit 3
fi

# 2. credentials from the legacy app's own configuration, held in memory only
envf="$APP/.env"; [ -r "$envf" ] || { echo "cannot read $envf" >&2; exit 2; }
getv() { grep -E "^$1=" "$envf" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
DB_HOST=$(getv DB_HOST); DB_PORT=$(getv DB_PORT); DB_NAME=$(getv DB_DATABASE); DB_USER=$(getv DB_USERNAME); DB_PASS=$(getv DB_PASSWORD)
export MYSQL_PWD="$DB_PASS"

# 3. consistent, lock-free, read-only dump of ONE table
if ! mysqldump -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "$DB_USER" --single-transaction --no-tablespaces --skip-lock-tables --default-character-set=utf8mb4 "$DB_NAME" articles 2>"$OUT/dump.err" | gzip > "$OUT/articles.sql.gz"; then
  echo "dump failed (see dump.err; it contains no credentials)" | tee -a "$REPORT"; exit 4
fi
sha=$(sha256sum "$OUT/articles.sql.gz" | cut -d' ' -f1)
{
  echo "articles.sql.gz sha256 $sha  bytes $(stat -c %s "$OUT/articles.sql.gz")"
  echo "--- rows by article_type / status / show_public / deleted"
  mysql -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "$DB_USER" -N -B "$DB_NAME" -e "select article_type, status, show_public, (deleted_at is not null) as deleted, count(*), min(id), max(id) from articles group by 1,2,3,4 order by 1,2,3,4" 2>/dev/null
} >> "$REPORT"
unset MYSQL_PWD DB_PASS

# 4. image manifest (names, sizes, hashes only; symlinks are not followed)
printf 'path\tbytes\tmtime_epoch\tsha256\n' > "$OUT/article-images.tsv"
for d in "$APP/storage/app/public/article" "$APP/storage/app/public/articles" "$APP/storage/app/public/article_poster" "$APP/storage/app/public/editor_uploads" "$APP/storage/app/public/editor"; do
  [ -d "$d" ] || continue
  find "$d" -type f ! -type l -print0 | while IFS= read -r -d '' f; do
    printf '%s\t%s\t%s\t%s\n' "${f#"$APP"/}" "$(stat -c %s -- "$f")" "$(stat -c %Y -- "$f")" "$(sha256sum -- "$f" | cut -d' ' -f1)"
  done >> "$OUT/article-images.tsv"
done
echo "image files listed: $(($(wc -l < "$OUT/article-images.tsv") - 1))" >> "$REPORT"
echo "done. Send back: $REPORT  $OUT/article-images.tsv  and (via WinSCP) $OUT/articles.sql.gz"
