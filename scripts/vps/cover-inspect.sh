#!/bin/bash
# READ-ONLY inspection of the legacy cover folder. It reads file names, sizes, dates and the first bytes of each file (the `file` command); it never opens a file as code, never
# runs, moves, changes or deletes anything, and writes ONLY the two report files below, into a folder you name (default: your own transfer account's home).
#
#   bash cover-inspect.sh [source-dir] [report-dir]
#   defaults: /home/aawraq.com/public_html/storage/app/public/product_cover   and   /home/aawraq_transfer/cover-inspect
#
# Output:  cover-report.txt (the summary to read and send back)   cover-manifest.tsv (path, bytes, mtime epoch, sha256, mime type for every file)
# The legacy app names a cover  <time()><rand 1-3 digits><date('Ymdis')>.webp  (or copy_<time()><date('Ymdis')>.<ext> for a cloned book); the report counts how many names follow that.
set -u
export LC_ALL=C
SRC="${1:-/home/aawraq.com/public_html/storage/app/public/product_cover}"
OUT="${2:-/home/aawraq_transfer/cover-inspect}"
[ -d "$SRC" ] || { echo "no such folder: $SRC" >&2; exit 2; }
mkdir -p -- "$OUT" || { echo "cannot create $OUT" >&2; exit 2; }
REPORT="$OUT/cover-report.txt"
MANIFEST="$OUT/cover-manifest.tsv"
: > "$MANIFEST"

total=0; bytes=0; imgs=0; nonimg=0; conv=0; copyn=0; other=0; links=0
declare -A ext_count mime_count
min_m=; max_m=
printf 'path\tbytes\tmtime_epoch\tsha256\tmime\n' > "$MANIFEST"
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  if [ -L "$f" ]; then links=$((links+1)); continue; fi        # a link could point anywhere: never followed, only counted
  total=$((total+1))
  size=$(stat -c %s -- "$f"); mt=$(stat -c %Y -- "$f")
  bytes=$((bytes+size))
  [ -z "$min_m" ] || [ "$mt" -lt "$min_m" ] && min_m=$mt
  [ -z "$max_m" ] || [ "$mt" -gt "$max_m" ] && max_m=$mt
  mime=$(file -b --mime-type -- "$f" 2>/dev/null || echo unknown)   # reads the first bytes only
  sha=$(sha256sum -- "$f" | cut -d' ' -f1)
  base="${rel##*/}"; e="${base##*.}"; [ "$e" = "$base" ] && e="(none)"; e=$(printf '%s' "$e" | tr 'A-Z' 'a-z')
  ext_count[$e]=$(( ${ext_count[$e]:-0} + 1 )); mime_count[$mime]=$(( ${mime_count[$mime]:-0} + 1 ))
  case "$mime" in image/webp|image/jpeg|image/png) imgs=$((imgs+1)) ;; *) nonimg=$((nonimg+1)) ;; esac
  if printf '%s' "$base" | grep -Eq '^[0-9]{10}[0-9]{1,3}[0-9]{12}\.(webp|jpe?g|png)$'; then conv=$((conv+1))
  elif printf '%s' "$base" | grep -Eq '^copy_[0-9]{10}[0-9]{12}\.(webp|jpe?g|png)$'; then copyn=$((copyn+1))
  else other=$((other+1)); fi
  safe=$(printf '%s' "$rel" | tr '\n\r\t' '???')   # a newline or tab inside a file name must not split a manifest row (the real name is only changed in this report)
  printf '%s\t%s\t%s\t%s\t%s\n' "$safe" "$size" "$mt" "$sha" "$mime" >> "$MANIFEST"
done < <(find "$SRC" \( -type f -o -type l \) -print0)

dupes=$(tail -n +2 "$MANIFEST" | cut -f4 | sort | uniq -d | wc -l)
dated() { [ -n "$1" ] && date -u -d "@$1" '+%Y-%m-%d %H:%M UTC' || echo '-'; }
{
  echo "AAWRAQ cover folder inspection (read-only)  $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo "folder: $SRC"
  echo "files: $total   total size: $bytes bytes ($((bytes/1048576)) MiB)   links skipped: $links"
  echo "oldest file: $(dated "$min_m")   newest file: $(dated "$max_m")"
  echo "images by their first bytes (webp/jpeg/png): $imgs    anything else: $nonimg"
  echo "names that follow the legacy cover naming: $conv   clone names (copy_...): $copyn   other names: $other"
  echo "groups of files with identical content: $dupes"
  echo; echo "extensions:"; for k in "${!ext_count[@]}"; do printf '  %-10s %s\n' "$k" "${ext_count[$k]}"; done | sort
  echo; echo "types (by first bytes):"; for k in "${!mime_count[@]}"; do printf '  %-28s %s\n' "$k" "${mime_count[$k]}"; done | sort
  echo; echo "files that are NOT webp/jpeg/png by their first bytes (names only, never opened):"
  tail -n +2 "$MANIFEST" | awk -F'\t' '$5!="image/webp" && $5!="image/jpeg" && $5!="image/png" {print "  " $1 "  (" $5 ")"}' | head -50
  echo; echo "manifest: $MANIFEST"
} > "$REPORT"
cat "$REPORT"
