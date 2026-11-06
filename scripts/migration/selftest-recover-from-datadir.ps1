# Self-test of recover-from-datadir.ps1 with a SYNTHETIC crashed MariaDB datadir (no real data involved).
#   powershell -NoProfile -File scripts/migration/selftest-recover-from-datadir.ps1
# Builds a MariaDB with catalogue tables + fake "sensitive" tables, kills it with SIGKILL (a crash, like a stuck server's files), copies the
# datadir like a download, then checks: crash recovery works, only catalogue tables are dumped, the dump restores identically, the copy is
# untouched, refusals fire, and a corrupted table is skipped while the others are still recovered. Everything is removed at the end.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$rec = Join-Path $PSScriptRoot 'recover-from-datadir.ps1'
$T = 'D:\mostqel\aawraq-recover-selftest'
$img = 'mariadb:10.6'
$gen = 'aawraq-selftest-generator'
$pass = 0; $fail = 0
function Check($name, $cond) { if ($cond) { $script:pass++; Write-Host "PASS  $name" -ForegroundColor Green } else { $script:fail++; Write-Host "FAIL  $name" -ForegroundColor Red } }
function Run-Recovery([string[]]$extra) { (& powershell -NoProfile -File $rec @extra 2>&1 | Out-String) }
function Sh([string]$q) { & docker exec $gen mariadb -uroot -ptest-root --batch --skip-column-names -e $q 2>&1 | Out-String }
function Cleanup {
  & docker rm -f $gen 2>$null | Out-Null
  & powershell -NoProfile -File $rec -Remove -WorkRoot "$T\wr" 2>$null | Out-Null
  & powershell -NoProfile -File (Join-Path $PSScriptRoot 'restore-legacy-db.ps1') -Remove -WorkDir "$T\wr\verify-restore" 2>$null | Out-Null
  if (Test-Path $T) { Remove-Item -Recurse -Force $T -ErrorAction SilentlyContinue }
}
Cleanup
New-Item -ItemType Directory -Force -Path "$T\srcdata" | Out-Null

Write-Host "=== building a synthetic crashed datadir"
& docker run -d --name $gen -v "$T\srcdata:/var/lib/mysql" -e MARIADB_ROOT_PASSWORD=test-root $img --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci | Out-Null
for ($i = 0; $i -lt 150; $i++) { & docker exec $gen mariadb --protocol=tcp "-h127.0.0.1" -uroot -ptest-root -e 'SELECT 1' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 2 }
$ar = "CONVERT(UNHEX('D983D8AAD8A7D8A8') USING utf8mb4)"   # an Arabic word, built from bytes so no non-ASCII text crosses the command line
Sh "CREATE DATABASE aawraq_selftest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" | Out-Null
$ddl = @(
  'CREATE TABLE books (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, cost VARCHAR(32), status TINYINT NOT NULL DEFAULT 1, KEY k_status (status)) ENGINE=InnoDB',
  'CREATE TABLE book_media (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, book_id BIGINT UNSIGNED NOT NULL, file VARCHAR(255), external TINYINT NOT NULL DEFAULT 0, KEY k_book (book_id)) ENGINE=InnoDB',
  'CREATE TABLE categories (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL) ENGINE=InnoDB',
  'CREATE TABLE makers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, type TINYINT) ENGINE=InnoDB',
  'CREATE TABLE users (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255), password VARCHAR(255)) ENGINE=InnoDB',
  'CREATE TABLE orders (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id BIGINT, amount VARCHAR(32)) ENGINE=InnoDB'
)
foreach ($d in $ddl) { Sh "USE aawraq_selftest; $d" | Out-Null }
Sh "USE aawraq_selftest; INSERT INTO books (name,cost,status) SELECT CONCAT($ar,' ',seq), '12.50', seq % 3 FROM seq_1_to_3000" | Out-Null
Sh "USE aawraq_selftest; INSERT INTO book_media (book_id,file,external) SELECT 1 + (seq % 3000), CONCAT('product_media/selftest-', 1600000000 + seq, '.pdf'), 0 FROM seq_1_to_4000" | Out-Null
Sh "USE aawraq_selftest; INSERT INTO categories (name) SELECT CONCAT($ar,' c',seq) FROM seq_1_to_30" | Out-Null
Sh "USE aawraq_selftest; INSERT INTO makers (name,type) SELECT CONCAT($ar,' m',seq), seq % 2 FROM seq_1_to_40" | Out-Null
Sh "USE aawraq_selftest; INSERT INTO users (email,password) SELECT CONCAT('person', seq, '@selftest.invalid'), 'SECRET-HASH-MARKER' FROM seq_1_to_500" | Out-Null
Sh "USE aawraq_selftest; INSERT INTO orders (user_id,amount) SELECT seq, '9.99' FROM seq_1_to_100" | Out-Null
# another site's database living in the same server: it is out of scope and must be LEFT OUT of the copy (see T4)
Sh "CREATE DATABASE other_site CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" | Out-Null
Sh "USE other_site; CREATE TABLE other_things (id INT AUTO_INCREMENT PRIMARY KEY, v VARCHAR(50)) ENGINE=InnoDB" | Out-Null
Sh "USE other_site; INSERT INTO other_things (v) SELECT CONCAT('other-site-private-', seq) FROM seq_1_to_500" | Out-Null
$counts = (Sh "SELECT (SELECT COUNT(*) FROM aawraq_selftest.books),(SELECT COUNT(*) FROM aawraq_selftest.book_media),(SELECT COUNT(*) FROM aawraq_selftest.categories),(SELECT COUNT(*) FROM aawraq_selftest.makers)").Trim()
Write-Host "synthetic rows (books, media, categories, makers): $counts"
& docker kill $gen | Out-Null    # SIGKILL: no clean shutdown, redo log not checkpointed -> a crashed datadir
& docker rm -f $gen | Out-Null
Write-Host "server killed uncleanly; copying the datadir like a download"
New-Item -ItemType Directory -Force -Path "$T\copy" | Out-Null
& robocopy "$T\srcdata" "$T\copy" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
Check 'crashed datadir copied (ibdata1 and the database folder exist)' ((Test-Path "$T\copy\ibdata1") -and (Test-Path "$T\copy\aawraq_selftest"))
# the realistic download: the same files but WITHOUT the other site's database folder
New-Item -ItemType Directory -Force -Path "$T\copy_noother" | Out-Null
& robocopy "$T\srcdata" "$T\copy_noother" /E /XD other_site /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
Check 'T0 the "download" for T4 excludes the other site database folder' ((Test-Path "$T\copy\other_site") -and -not (Test-Path "$T\copy_noother\other_site"))
Write-Host "      copy_noother: $((Get-ChildItem "$T\copy_noother" -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count) files"
# a CLEANLY shut-down variant: its data is in the .ibd files (not only in the redo log), so damage to a file is not healed by redo replay
New-Item -ItemType Directory -Force -Path "$T\srcclean" | Out-Null
& robocopy "$T\srcdata" "$T\srcclean" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
& docker run -d --name "$gen-clean" -v "$T\srcclean:/var/lib/mysql" -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 $img --skip-grant-tables | Out-Null
for ($i = 0; $i -lt 150; $i++) { & docker exec "$gen-clean" mariadb --protocol=socket -uroot -e 'SELECT COUNT(*) FROM aawraq_selftest.categories' 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 2 }
& docker stop -t 120 "$gen-clean" | Out-Null; & docker rm -f "$gen-clean" | Out-Null      # graceful stop: checkpoint, data flushed into the .ibd files
New-Item -ItemType Directory -Force -Path "$T\copy_clean" | Out-Null
& robocopy "$T\srcclean" "$T\copy_clean" /E /XD other_site /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
Check 'T0 a cleanly shut-down copy exists (the "download" for the corruption test)' ((Test-Path "$T\copy_clean\ibdata1") -and (Test-Path "$T\copy_clean\aawraq_selftest\categories.ibd"))

Write-Host "`n=== T1: happy path on the crashed copy"
$before = (Get-ChildItem "$T\copy" -Recurse -File | ForEach-Object { "$($_.FullName.Substring($T.Length))|$($_.Length)|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)" } | Sort-Object) -join "`n"
$o1 = Run-Recovery @('-DataDirCopy', "$T\copy", '-Database', 'aawraq_selftest', '-WorkRoot', "$T\wr", '-RestorePort', '33397', '-EncryptionHint', 'no')
Write-Host ($o1 -split "`r?`n" | Select-Object -Last 14 | Out-String)
Check 'T1 recovered the critical tables (all four clean)' ($o1 -match 'clean critical tables 4/4')
Check 'T1 fidelity verified (restored dump == recovered server)' ($o1 -match 'fidelity verified: True')
$after = (Get-ChildItem "$T\copy" -Recurse -File | ForEach-Object { "$($_.FullName.Substring($T.Length))|$($_.Length)|$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)" } | Sort-Object) -join "`n"
Check 'T1 the downloaded copy is byte-for-byte untouched' ($before -eq $after)
$dump = Get-ChildItem "$T\wr\out" -Filter 'core-dump-*.sql.gz' | Select-Object -First 1
Check 'T1 a dump file exists' ($null -ne $dump)
if ($dump) {
  $fs = [System.IO.File]::OpenRead($dump.FullName); $gz = New-Object System.IO.Compression.GZipStream($fs, [System.IO.Compression.CompressionMode]::Decompress); $rd = New-Object System.IO.StreamReader($gz); $txt = $rd.ReadToEnd(); $rd.Close(); $fs.Close()
  Check 'T1 dump has the catalogue data' (($txt -match 'INSERT INTO `books`') -and ($txt -match 'INSERT INTO `book_media`') -and ($txt -match 'INSERT INTO `categories`') -and ($txt -match 'INSERT INTO `makers`'))
  Check 'T1 sensitive tables have STRUCTURE only: no user rows, no hashes, no orders' (($txt -notmatch 'INSERT INTO `users`') -and ($txt -notmatch 'SECRET-HASH-MARKER') -and ($txt -notmatch 'selftest.invalid') -and ($txt -notmatch 'INSERT INTO `orders`'))
  Check 'T1 raw price strings and file names are preserved' (($txt -match "12\.50") -and ($txt -match 'product_media/selftest-16'))
}
$rep = Get-ChildItem "$T\wr\out" -Filter 'recovery-report-*.json' | Select-Object -First 1
if ($rep) { $j = Get-Content $rep.FullName -Raw | ConvertFrom-Json; Check "T1 report: row counts match the synthetic data ($counts)" ((($j.tables | Where-Object { $_.table -in 'books','book_media','categories','makers' } | ForEach-Object { $_.rows }) -join ', ') -eq ($counts -replace '\s+', ', ')) }
& powershell -NoProfile -File $rec -Remove -WorkRoot "$T\wr" | Out-Null

Write-Host "`n=== T2: refusals"
$r = Run-Recovery @('-DataDirCopy', "$T\nope", '-WorkRoot', "$T\wr2");                                                   Check 'T2 missing folder refused' ($r -match 'REFUSING')
New-Item -ItemType Directory -Force -Path "$T\notdb\mysql" | Out-Null
$r = Run-Recovery @('-DataDirCopy', "$T\notdb", '-WorkRoot', "$T\wr2");                                                 Check 'T2 folder without ibdata1 refused' ($r -match 'no ibdata1')
$r = Run-Recovery @('-DataDirCopy', "$T\copy", '-WorkRoot', "$T\wr2", '-EncryptionHint', 'yes');                         Check 'T2 encryption hint refused' ($r -match 'encryption')
$r = Run-Recovery @('-DataDirCopy', "$T\copy", '-WorkRoot', "$T\wr2", '-EncryptionHint', 'no');                           Check 'T2 a copy holding TWO application databases is refused until -Database is named (no guessing)' ($r -match 'copy holds 2 application database folders')
$r = Run-Recovery @('-DataDirCopy', "$T\copy", '-Database', 'aawraq_selftest', '-WorkRoot', "$T\wr2", '-Tables', 'books,users');  Check 'T2 sensitive table without authorisation refused (comma list given as one string)' ($r -match 'needs -IncludeSensitive')
$r = Run-Recovery @('-DataDirCopy', "$T\copy", '-Database', 'aawraq_selftest', '-WorkRoot', "$T\wr2", '-Tables', 'books;drop');   Check 'T2 injection-shaped table name refused' ($r -match 'invalid table name')
$r = Run-Recovery @('-DataDirCopy', "$T\copy", '-WorkRoot', "$T\wr2", '-Database', 'not_there');                         Check 'T2 unknown database refused' ($r -match "no folder 'not_there'")
Check 'T2 refusals created no container' (@(& docker ps -a --filter 'name=aawraq-datadir-recovery' --format '{{.Names}}').Count -eq 0)

Write-Host "`n=== T3: one corrupted table must not stop the others"
$cat = "$T\copy_clean\aawraq_selftest\categories.ibd"
$bytes = [System.IO.File]::ReadAllBytes($cat); Write-Host "categories.ibd is $($bytes.Length) bytes"
# page 3 (offset 49152) is the root index page that holds the rows of this small table; pages 0-2 are header / bitmap / inode pages
$fsw = [System.IO.File]::Open($cat, 'Open', 'ReadWrite'); $junk = New-Object byte[] 8192; (New-Object System.Random 7).NextBytes($junk); [void]$fsw.Seek(16384 * 3, 'Begin'); $fsw.Write($junk, 0, $junk.Length); $fsw.Close()
$o3 = Run-Recovery @('-DataDirCopy', "$T\copy_clean", '-Database', 'aawraq_selftest', '-WorkRoot', "$T\wr3", '-RestorePort', '33396', '-EncryptionHint', 'no')
Write-Host ($o3 -split "`r?`n" | Select-Object -Last 22 | Out-String)
$rep3 = Get-ChildItem "$T\wr3\out" -Filter 'recovery-report-*.json' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($rep3) {
  $j3 = Get-Content $rep3.FullName -Raw | ConvertFrom-Json
  $st = @{}; foreach ($row in $j3.tables) { $st[$row.table] = $row }
  Check 'T3 books/book_media/makers were still recovered' (($st['books'].dumped) -and ($st['book_media'].dumped) -and ($st['makers'].dumped))
  Check 'T3 the corruption was DETECTED and reported (state damaged/unreadable), not hidden' ($st['categories'].state -in @('damaged', 'unreadable'))
  Check 'T3 the damaged table is NOT in the verified core dump (no partial data mixed in)' (-not $st['categories'].dumped)
  Check 'T3 a partial-salvage entry exists, flagged partial' ($null -ne $st['categories'].salvage -and $st['categories'].salvage.partial)
  Check 'T3 the report lists the damaged table' ($j3.damaged_or_unreadable -contains 'categories')
  Check 'T3 the clean tables were fidelity-verified' ($j3.fidelity_verified -eq $true)
  Write-Host "      categories: state=$($st['categories'].state) dumped=$($st['categories'].dumped) salvage=$($st['categories'].salvage | ConvertTo-Json -Compress) level used=$($j3.innodb_force_recovery_used)"
} else { Check 'T3 produced a report (partial recovery)' $false }
& powershell -NoProfile -File $rec -Remove -WorkRoot "$T\wr3" | Out-Null

Write-Host "`n=== T4: the realistic download - another site's database folder is NOT in the copy"
Write-Host "      diagnostics before T4: copy_noother exists=$(Test-Path "$T\copy_noother") files=$((Get-ChildItem "$T\copy_noother" -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count) ibdata1=$(Test-Path "$T\copy_noother\ibdata1")"
$o4 = Run-Recovery @('-DataDirCopy', "$T\copy_noother", '-WorkRoot', "$T\wr4", '-RestorePort', '33395', '-EncryptionHint', 'no')
Write-Host ($o4 -split "`r?`n" | Select-Object -Last 16 | Out-String)
$rep4 = Get-ChildItem "$T\wr4\out" -Filter 'recovery-report-*.json' -ErrorAction SilentlyContinue | Select-Object -First 1
Check 'T4 recovery succeeds without the other site folder' ($null -ne $rep4)
if ($rep4) {
  $j4 = Get-Content $rep4.FullName -Raw | ConvertFrom-Json
  Write-Host "      level used: $($j4.innodb_force_recovery_used) | attempts: $(($j4.attempts | ForEach-Object { 'L' + $_.level + '=' + $(if ($_.up) { 'up' } else { 'down' }) }) -join ', ')"
  Check 'T4 all four critical tables are clean and the dump is verified' (($j4.critical_readable -eq 4) -and ($j4.fidelity_verified -eq $true))
  $d4 = Get-ChildItem "$T\wr4\out" -Filter 'core-dump-*.sql.gz' | Select-Object -First 1
  $fs4 = [System.IO.File]::OpenRead($d4.FullName); $g4 = New-Object System.IO.Compression.GZipStream($fs4, [System.IO.Compression.CompressionMode]::Decompress); $r4 = New-Object System.IO.StreamReader($g4); $x4 = $r4.ReadToEnd(); $r4.Close(); $fs4.Close()
  Check 'T4 nothing from the other site is in the dump' (($x4 -notmatch 'other_site') -and ($x4 -notmatch 'other-site-private'))
}
& powershell -NoProfile -File $rec -Remove -WorkRoot "$T\wr4" | Out-Null

Write-Host "`n=== cleanup"
Cleanup
Check 'cleanup: no test container, no listener, work folder gone' ((@(& docker ps -a --format '{{.Names}}' | Where-Object { $_ -like 'aawraq-*recovery*' -or $_ -like 'aawraq-selftest*' -or $_ -eq 'aawraq-legacy-restore' }).Count -eq 0) -and -not (Test-Path $T))
Write-Host "`nRESULT: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
