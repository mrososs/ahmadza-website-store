# Recover the catalogue tables from a COPY of the legacy MariaDB physical files (datadir), without touching the VPS or the copy itself.
#
#   powershell -NoProfile -File scripts/migration/recover-from-datadir.ps1 -DataDirCopy D:\mostqel\aawraq-quarantine\mysql-copy
#   REQUIRED: -SourceVersion X.Y.Z   the EXACT MariaDB version that wrote the copy (inspection FLAG mariadb_version). Never assumed, never defaulted.
#   optional: -Database aawraq_db  -Image mariadb:X.Y.Z  -WorkRoot D:\mostqel\aawraq-recovery  -Tables books,book_media,...
#             -EncryptionHint no|yes|unknown  -HashAll  -NoVerify  -RestorePort 33306  -AllowPatchDifference  -KeepRawLog  -Remove
#
# What it guarantees
#   * The downloaded copy is NEVER opened for writing: it is hashed (manifest), then copied to a work directory; every attempt starts from a
#     fresh copy of the pristine copy, and the work directory is hashed again to prove the copy was faithful.
#   * The recovery server has NO network (docker --network none), skips grant tables (so no legacy password is needed) and is thrown away.
#   * InnoDB crash recovery runs on the work copy (that is how a crashed datadir becomes consistent). If the server will not start, it
#     escalates innodb_force_recovery 1, 2, 3 and STOPS at 3 (values above 3 can alter data and are refused).
#   * Tables are extracted ONE BY ONE: a corrupt table is reported and skipped, readable tables are still recovered (incremental recovery).
#   * Only catalogue tables are dumped by default. Customer / financial tables are never dumped unless -IncludeSensitive and -OwnerAuthorised.
#     (They stay safe in the untouched copy and can be extracted later from it.)
#   * The recovery server must be the SAME MariaDB version family as the server that wrote the files (another major.minor may refuse to replay a crashed
#     redo log or silently misread it). The image version is read BEFORE anything is copied and must equal -SourceVersion (patch drift needs
#     -AllowPatchDifference); a major.minor mismatch is always refused. The datadir's own mysql_upgrade_info is cross-checked.
#   * Privacy: the copy holds OTHER sites' databases and the shared `mysql` schema (their password hashes). Neither is ever dumped. Other databases'
#     folder names and host-named files are replaced by hashed aliases in the manifest and the console; server logs are printed only after redaction
#     (account names, hosts, IPs, db.table names, paths, secrets) and raw logs are saved only with -KeepRawLog (private folder, never for sharing).
#   * The dump is verified by restoring it into the isolated restore container and comparing row counts and CHECKSUM TABLE with the recovered server.
param(
  [string]$DataDirCopy,
  [string]$Database,
  [string]$SourceVersion,
  [string]$Image,
  [string]$WorkRoot = 'D:\mostqel\aawraq-recovery',
  [string[]]$Tables = @('books', 'book_media', 'categories', 'makers', 'related_books', 'site_infos', 'articles', 'pages'),
  [string[]]$Critical = @('books', 'book_media', 'categories', 'makers'),
  [ValidateSet('no', 'yes', 'unknown')][string]$EncryptionHint = 'unknown',
  [switch]$HashAll,
  [switch]$NoVerify,
  [int]$RestorePort = 33306,
  [switch]$IncludeSensitive,
  [switch]$OwnerAuthorised,
  [switch]$AllowPatchDifference,
  [switch]$KeepRawLog,
  [switch]$Remove
)
# 'Continue' on purpose: Windows PowerShell 5.1 turns ANY native stderr line into a terminating error under 'Stop'.
# Every native call is checked through $LASTEXITCODE and fails explicitly instead.
$ErrorActionPreference = 'Continue'
$Name = 'aawraq-datadir-recovery'
$MaxForce = 3   # hard cap: higher innodb_force_recovery levels can modify or lose data
$Sensitive = @('users', 'user_verifies', 'password_resets', 'orders', 'payments', 'withdraws', 'affiliate_orders', 'affiliates', 'request_books', 'comments', 'favourites', 'contact_messages', 'payout_methods', 'sessions', 'jobs', 'failed_jobs', 'personal_access_tokens')
function Fail($m) { Write-Host "REFUSING: $m" -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host "ok    $m" -ForegroundColor Green }
function Info($m) { Write-Host "      $m" }
function Invoke-Docker { & docker.exe @args; if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed ($LASTEXITCODE)" } }
function Remove-Container { if (& docker ps -a --filter "name=^$Name$" --format '{{.Names}}') { & docker rm -f $Name | Out-Null } }
# SQL on the recovery server (socket, no credentials: grant tables are skipped and there is no network)
function Sql([string]$q) { $o = & docker exec $Name mariadb --protocol=socket -uroot --batch --skip-column-names -e $q 2>&1; return @{ Code = $LASTEXITCODE; Out = (($o | Out-String).Trim()) } }
function Sha256([string]$f) { (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash.ToLower() }

# ---- privacy helpers: nothing from OTHER sites on the same server, and no credentials, may reach the console or a report ---------------------
# The copy is a whole MariaDB datadir. Besides our database it holds other applications' databases (their names are other-site metadata) and the shared
# mysql system schema (their accounts and password hashes). This script never dumps either, and never prints their names.
function Redact-Log($text, [int]$Max = 6) {
  $lines = @(([string]$text -split "`r?`n") | Where-Object { $_.Trim() })
  $out = foreach ($l in $lines) {
    $x = $l
    $x = [regex]::Replace($x, "'[^']*'@'[^']*'", "'<user>'@'<host>'")
    $x = [regex]::Replace($x, '\b\d{1,3}(\.\d{1,3}){3}\b', '<ip>')
    $x = [regex]::Replace($x, '`([^`]+)`\.`([^`]+)`', '<db>.<table>')
    $x = [regex]::Replace($x, '(?i)(table|tablespace|file)(\s+)''?`?[A-Za-z0-9_$#-]+/[A-Za-z0-9_$#.-]+', '$1$2<db>/<table>')
    $x = [regex]::Replace($x, '(?i)(\./|/var/lib/mysql/|[A-Za-z]:[\\/])[^\s''",;)]*', '<path>')
    $x = [regex]::Replace($x, '(?i)\b(password|passwd|pwd|identified by|token|secret)\b\s*[=:]?\s*\S+', '$1 <redacted>')
    $x = [regex]::Replace($x, '^\s*\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}\s+(\d+\s+)?', '')
    if ($x.Length -gt 220) { $x = $x.Substring(0, 220) + '...' }
    $x
  }
  return @($out | Select-Object -Last $Max)
}
# Stable, non-reversible alias for a folder or file name that belongs to another application or to the host (two runs still compare equal).
function Anon-Name([string]$n) { 'x-' + ([BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($n))).Replace('-', '').ToLower().Substring(0, 8)) }
$RootFileOk = '^(ibdata\d*|ib_logfile\d+|ib_buffer_pool|ddl_recovery(-backup)?\.log|aria_log(_control|\.\d+)|mysql_upgrade_info|undo\d+|ibtmp\d*|multi-master\.info|tc\.log|auto\.cnf|ib_16384_.*)$'
function Anon-Path([string]$rel) {
  $parts = $rel -split [regex]::Escape([string][char]92)
  if ($parts.Count -eq 1) { if ($rel -match $RootFileOk) { return $rel } else { return (Anon-Name $rel) } }   # host-named files (*.pid, *-bin.*, *.err) carry the host name
  if ($sysDirs -contains $parts[0] -or $parts[0] -ieq $Database) { return $rel }
  $parts[0] = 'other-db-' + (Anon-Name $parts[0]).Substring(2)
  for ($i = 1; $i -lt $parts.Count; $i++) { $parts[$i] = Anon-Name $parts[$i] }
  return ($parts -join [string][char]92)
}
function Parse-Version([string]$s) { if ($s -match '(\d+)\.(\d+)\.(\d+)') { return @{ Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Patch = [int]$Matches[3]; Text = "$($Matches[1]).$($Matches[2]).$($Matches[3])" } } else { return $null } }

if ($Remove) {
  Remove-Container; Ok "container $Name removed"
  if (Test-Path "$WorkRoot\work") { Remove-Item -Recurse -Force "$WorkRoot\work"; Ok "work copy $WorkRoot\work removed (the downloaded copy and $WorkRoot\out are kept)" }
  exit 0
}

# 'powershell -File ... -Tables a,b' delivers ONE string "a,b" (not an array): split it so both call styles behave the same
$Tables = @($Tables | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Critical = @($Critical | ForEach-Object { $_ -split ',' } | Where-Object { $_ })

# ---- 1. the downloaded copy ----------------------------------------------------------------------------------------------------------
if (-not $DataDirCopy -or -not (Test-Path -LiteralPath $DataDirCopy -PathType Container)) { Fail "-DataDirCopy <folder> is required and must exist (a folder containing ibdata1, mysql\ and the database folder)" }
$src = (Resolve-Path -LiteralPath $DataDirCopy).Path.TrimEnd('\')
if ($src.Length -le 3) { Fail "refusing a drive root" }
if ($src -like "$WorkRoot*") { Fail "the copy must not live inside the work root" }
if (-not (Test-Path "$src\ibdata1")) { Fail "no ibdata1 in $src - this is not a MariaDB/InnoDB data directory (or the copy is incomplete)" }
if (-not (Test-Path "$src\mysql" -PathType Container)) { Fail "no mysql\ system folder in $src - incomplete copy" }
if ($EncryptionHint -eq 'yes') { Fail "the inspection reported encryption settings: encrypted tablespaces cannot be read without the server's key files. Stop and discuss before continuing" }
$sysDirs = @('mysql', 'performance_schema', 'sys', 'information_schema', '#innodb_redo', '#innodb_temp', '#rocksdb')
$dbDirs = @(Get-ChildItem -LiteralPath $src -Directory | Where-Object { $sysDirs -notcontains $_.Name } | Select-Object -ExpandProperty Name)
# the names of other applications' database folders are other-site metadata: counted here, never printed
if (-not $Database) {
  if ($dbDirs.Count -eq 1) { $Database = $dbDirs[0] } else { Fail "-Database is required: the copy holds $($dbDirs.Count) application database folders (names withheld: they may belong to other sites). Pass the name of OUR application's database" }
}
if ($Database -notmatch '^[A-Za-z0-9_]{1,64}$') { Fail "-Database must be a plain identifier" }
if ($sysDirs -contains $Database.ToLower()) { Fail "-Database cannot be a system schema: the shared mysql schema holds other sites' password hashes and is never recovered or dumped" }
if (-not (Test-Path "$src\$Database" -PathType Container)) { Fail "no folder '$Database' in the copy ($($dbDirs.Count) application database folders present, names withheld)" }

# ---- 1b. the EXACT MariaDB version: required, never assumed, checked on the image BEFORE anything is copied or started --------------------------
if (-not $SourceVersion) { Fail "-SourceVersion X.Y.Z is required: the exact MariaDB version that wrote this copy (the inspection prints it as FLAG mariadb_version). It is never assumed or defaulted" }
$want = Parse-Version $SourceVersion
if (-not $want -or $SourceVersion -notmatch '^\d+\.\d+\.\d+$') { Fail "-SourceVersion must look like 10.11.6 (major.minor.patch), got '$SourceVersion'" }
if (-not $Image) { $Image = "mariadb:$($want.Text)" }
if ($Image -notmatch '^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$') { Fail "-Image must be a plain image reference such as mariadb:$($want.Text)" }
$upg = Join-Path $src 'mysql_upgrade_info'
if (Test-Path -LiteralPath $upg) {
  $uv = Parse-Version ((Get-Content -LiteralPath $upg -TotalCount 1) -join '')
  if ($uv) {
    if ($uv.Major -ne $want.Major -or $uv.Minor -ne $want.Minor) { Fail "the copy's own mysql_upgrade_info says $($uv.Text) but -SourceVersion is $($want.Text): wrong version family. Re-check the inspection output" }
    if ($uv.Patch -ne $want.Patch) { Info "note: mysql_upgrade_info records $($uv.Text) (the last upgrade), -SourceVersion is $($want.Text): normal after patch updates" }
  }
}
$iv = (& docker run --rm --network none --entrypoint sh $Image -c 'mariadbd --version 2>&1 || mysqld --version 2>&1' 2>&1 | Out-String)
$have = Parse-Version (($iv -split "`r?`n" | Where-Object { $_ -match 'Ver\s+\d' } | Select-Object -First 1))
if (-not $have) { Fail "could not read the MariaDB version of image $Image (pull the exact tag first: docker pull $Image)" }
if ($have.Major -ne $want.Major -or $have.Minor -ne $want.Minor) { Fail "image $Image is MariaDB $($have.Text) but the copy was written by $($want.Text): a different major.minor may refuse to replay the crashed redo log or misread it. Use an image of the same major.minor (ideally mariadb:$($want.Text))" }
if ($have.Patch -ne $want.Patch) {
  if (-not $AllowPatchDifference) { Fail "image $Image is MariaDB $($have.Text), the copy was written by $($want.Text): not the exact version. Pull mariadb:$($want.Text), or pass -AllowPatchDifference to accept patch-level drift inside the same $($want.Major).$($want.Minor) series" }
  Write-Host "WARNING: patch-level difference accepted ($($have.Text) vs $($want.Text)), same $($want.Major).$($want.Minor) series" -ForegroundColor Yellow
}
Ok "MariaDB version: copy written by $($want.Text); recovery image $Image is $($have.Text)"
foreach ($t in $Tables) { if ($t -notmatch '^[A-Za-z0-9_]{1,64}$') { Fail "invalid table name '$t'" } }
$wanted = @($Tables | ForEach-Object { $_.ToLower() })
$sens = @($wanted | Where-Object { $Sensitive -contains $_ })
if ($sens.Count -gt 0 -and -not ($IncludeSensitive -and $OwnerAuthorised)) { Fail "customer/financial tables requested ($($sens -join ', ')): needs -IncludeSensitive and -OwnerAuthorised (written owner authorisation). Catalogue tables only by default" }
$srcBytes = (Get-ChildItem -LiteralPath $src -Recurse -File -Force | Measure-Object Length -Sum).Sum
Ok "copy accepted: $src ($([math]::Round($srcBytes/1MB,1)) MiB); database '$Database'; application database folders in the copy: $($dbDirs.Count) (only '$Database' is read)"
$drive = (Split-Path -Qualifier (New-Item -ItemType Directory -Force -Path $WorkRoot).FullName)
$free = (Get-PSDrive ($drive.TrimEnd(':'))).Free
if ($free -lt (2.5 * $srcBytes)) { Fail "work drive $drive has $([math]::Round($free/1GB,1)) GiB free, need about $([math]::Round(2.5*$srcBytes/1GB,1)) GiB (2.5x the copy)" }
if (& docker ps -a --filter "name=^$Name$" --format '{{.Names}}') { Fail "container $Name already exists; never overwritten. Run with -Remove first" }
New-Item -ItemType Directory -Force -Path "$WorkRoot\out" | Out-Null

# ---- 2. manifest of the pristine copy (proves later that nothing touched it) -----------------------------------------------------------
function Get-Manifest([string]$root) {
  $files = Get-ChildItem -LiteralPath $root -Recurse -File -Force
  foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\')
    $top = ($rel -split '\\')[0]
    $hash = ''
    if ($HashAll -or $rel -notmatch '\\' -or $top -ieq 'mysql' -or $top -ieq $Database) { $hash = Sha256 $f.FullName }
    [pscustomobject]@{ path = $rel; bytes = $f.Length; sha256 = $hash }
  }
}
$t0 = Get-Date
$manifest = @(Get-Manifest $src)
$manifest | ForEach-Object { [pscustomobject]@{ path = (Anon-Path $_.path); bytes = $_.bytes; sha256 = $_.sha256 } } | Export-Csv -NoTypeInformation -Encoding ascii "$WorkRoot\out\manifest-source.csv"   # other sites' folder names and host-named files are aliased
$manifestId = ($manifest | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" } | Sort-Object) -join "`n"
$manifestSha = [BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($manifestId))).Replace('-', '').ToLower()
Ok "manifest of the pristine copy: $($manifest.Count) files, fingerprint $manifestSha ($([math]::Round(((Get-Date)-$t0).TotalSeconds,1)) s) -> out\manifest-source.csv"

# ---- 3. attempt ladder: fresh copy of the copy, start without network, check the critical tables -----------------------------------
function New-WorkCopy {
  if (Test-Path "$WorkRoot\work") { Remove-Item -Recurse -Force "$WorkRoot\work" }
  New-Item -ItemType Directory -Force -Path "$WorkRoot\work\datadir" | Out-Null
  & robocopy $src "$WorkRoot\work\datadir" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "robocopy failed ($LASTEXITCODE) while copying the copy" }
  $mine = @(Get-Manifest "$WorkRoot\work\datadir")
  $a = ($mine | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" } | Sort-Object) -join "`n"
  if ($a -ne $manifestId) { Fail "the work copy differs from the pristine copy (copy error) - aborting" }
}
function Start-Level([int]$level) {
  Remove-Container
  New-WorkCopy
  $args2 = @('--skip-grant-tables', '--skip-log-bin')
  if ($level -gt 0) { $args2 += "--innodb-force-recovery=$level" }
  Invoke-Docker run -d --name $Name --network none -v "$WorkRoot\work\datadir:/var/lib/mysql" -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 $Image @args2 | Out-Null
  for ($i = 0; $i -lt 300; $i++) {
    $running = (& docker inspect -f '{{.State.Running}}' $Name 2>$null)
    if ($running -ne 'true') { return @{ Up = $false; Why = 'the server exited' } }
    $r = Sql 'SELECT 1'
    if ($r.Code -eq 0) { return @{ Up = $true } }
    if ($i -gt 0 -and $i % 15 -eq 0) { Info "...still starting (crash recovery can take a while on a large datadir; $($i*2) s)" }
    Start-Sleep -Seconds 2
  }
  return @{ Up = $false; Why = 'did not accept connections within 10 minutes' }
}
function Probe-Tables {
  $present = @{}
  $r = Sql "SELECT table_name FROM information_schema.tables WHERE table_schema='$Database' AND table_type='BASE TABLE'"
  if ($r.Code -eq 0 -and $r.Out) { foreach ($t in ($r.Out -split "`r?`n")) { $present[$t.Trim().ToLower()] = $true } }
  $status = @{}
  foreach ($t in $wanted) {
    if (-not $present.ContainsKey($t)) { $status[$t] = @{ state = 'absent'; rows = $null; error = 'table not present in the database folder' }; continue }
    $c = Sql "SELECT COUNT(*) FROM ``$Database``.``$t``"
    if ($c.Code -ne 0) { $status[$t] = @{ state = 'unreadable'; rows = $null; error = ((Redact-Log $c.Out 1) -join ' ') }; continue }
    # COUNT(*) can be answered from a secondary index without touching a damaged data page, so it proves nothing about integrity:
    # CHECK TABLE reads every page of the clustered and secondary indexes. A table that counts but fails the check is 'damaged'.
    $ck = Sql "CHECK TABLE ``$Database``.``$t``"
    $bad = @(($ck.Out -split "`r?`n") | Where-Object { $_.Trim() -and (($_ -split "`t")[-1]).Trim() -ne 'OK' })
    if ($ck.Code -ne 0 -or $bad.Count -gt 0) { $status[$t] = @{ state = 'damaged'; rows = [int64]$c.Out; error = ((Redact-Log ($bad -join "`n") 2) -join ' | ') } }
    else { $status[$t] = @{ state = 'readable'; rows = [int64]$c.Out; error = $null } }
  }
  return @{ present = @($present.Keys); status = $status }
}
function Score($p) { @($Critical | Where-Object { $p.status.ContainsKey($_) -and $p.status[$_].state -eq 'readable' }).Count }

$best = $null; $levelUsed = $null; $attempts = @(); $serverVersion = $null
for ($level = 0; $level -le $MaxForce; $level++) {
  Write-Host "`n--- attempt: innodb_force_recovery=$level (fresh copy of the pristine copy, no network)"
  $s = Start-Level $level
  if (-not $s.Up) {
    $rawLog = (& docker logs --tail 40 $Name 2>&1 | Out-String)
    if ($KeepRawLog) {
      New-Item -ItemType Directory -Force -Path "$WorkRoot\private" | Out-Null
      "RAW server log. May contain other sites' database names and account names. PRIVATE: never share, never commit." | Set-Content -Encoding ascii "$WorkRoot\private\README.txt"
      $rawLog | Set-Content -Encoding utf8 "$WorkRoot\private\server-log-level$level.txt"
    }
    Info "server did not come up: $($s.Why)"; (Redact-Log $rawLog 6) | ForEach-Object { Info "  | $_" }   # redacted: no accounts, hosts, db.table names, paths
    $rawLog = $null
    $attempts += @{ level = $level; up = $false; why = $s.Why }
    continue
  }
  if (-not $serverVersion) {
    $serverVersion = (Sql 'SELECT VERSION()').Out
    $sv = Parse-Version $serverVersion
    if (-not $sv -or $sv.Major -ne $want.Major -or $sv.Minor -ne $want.Minor) { Remove-Container; Fail "the running recovery server reports version '$serverVersion', not the $($want.Major).$($want.Minor) series of the copy - refusing to read it" }
    Info "recovery server version: $serverVersion"
  }
  $p = Probe-Tables
  $score = Score $p
  Ok "server is up at level $level; critical tables readable: $score of $($Critical.Count)"
  foreach ($t in $wanted) { $st = $p.status[$t]; Info ('{0,-16} {1,-10} {2}' -f $t, $st.state, $(if ($st.state -eq 'readable') { "$($st.rows) rows" } else { $st.error })) }
  $attempts += @{ level = $level; up = $true; critical_readable = $score }
  if (-not $best -or $score -gt $best.score) { $best = @{ level = $level; score = $score; probe = $p } }
  if ($score -eq $Critical.Count) { $levelUsed = $level; break }
}
if (-not $best -or $best.score -eq 0) {
  Remove-Container
  Fail "no critical table could be read at any safe recovery level (0-$MaxForce). The pristine copy is untouched. Next: try the other Hostinger backup, or a copy taken while MariaDB was cleanly stopped; do NOT raise innodb_force_recovery above $MaxForce"
}
if ($null -eq $levelUsed) {
  Write-Host "`nno level made every critical table readable; using the best one (level $($best.level), $($best.score) of $($Critical.Count)) - the report lists what is missing"
  $s = Start-Level $best.level; if (-not $s.Up) { Fail "could not restart the best level" }
  $levelUsed = $best.level
}
$probe = Probe-Tables
$readable = @($wanted | Where-Object { $probe.status[$_].state -eq 'readable' })             # clean: goes into the verified core dump
$needSalvage = @($wanted | Where-Object { $probe.status[$_].state -in @('damaged', 'unreadable') })   # partial data only, kept apart from the core dump
if ($needSalvage.Count -gt 0) { Write-Host "`nWARNING: not clean at level ${levelUsed}: $($needSalvage -join ', ') - the core dump excludes them; a labelled partial salvage is attempted afterwards" -ForegroundColor Yellow }

# ---- 4. extraction, table by table ------------------------------------------------------------------------------------------------
Write-Host "`n--- extraction (schema of every table + data of the readable requested tables)"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sch = & docker exec $Name sh -c "mariadb-dump --protocol=socket -uroot --no-data --skip-lock-tables --default-character-set=utf8mb4 $Database > /tmp/schema.sql" 2>&1
$schemaOk = ($LASTEXITCODE -eq 0)
if ($schemaOk) { Ok "schema of all tables extracted" } else { Info "schema-only dump of the whole database failed ($((Redact-Log ($sch | Out-String) 1) -join ' ')); extracting per table instead" }
$dumped = @{}
foreach ($t in $readable) {
  $o = & docker exec $Name sh -c "mariadb-dump --protocol=socket -uroot --default-character-set=utf8mb4 --skip-lock-tables --single-transaction --hex-blob $Database $t > /tmp/t_$t.sql" 2>&1
  if ($LASTEXITCODE -eq 0) { $dumped[$t] = $true; Ok "table $t extracted" } else { $dumped[$t] = $false; Info "table $t FAILED: $((Redact-Log ($o | Out-String) 1) -join ' ')" }
}
$parts = @(); if ($schemaOk) { $parts += '/tmp/schema.sql' }; foreach ($t in $readable) { if ($dumped[$t]) { $parts += "/tmp/t_$t.sql" } }
if ($parts.Count -eq 0) { Remove-Container; Fail "nothing could be extracted" }
$dumpName = "core-dump-$stamp.sql.gz"
& docker exec $Name sh -c "cat $($parts -join ' ') | gzip -9 > /tmp/core.sql.gz" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "could not assemble the dump" }
Invoke-Docker cp "${Name}:/tmp/core.sql.gz" "$WorkRoot\out\$dumpName"
$dumpSha = Sha256 "$WorkRoot\out\$dumpName"
"$dumpSha  $dumpName" | Set-Content -Encoding ascii "$WorkRoot\out\$dumpName.sha256"
Ok "dump written: $WorkRoot\out\$dumpName ($([math]::Round((Get-Item "$WorkRoot\out\$dumpName").Length/1KB,1)) KiB, sha256 $dumpSha)"

# ---- 5. checksums on the recovered server (for the fidelity check) -----------------------------------------------------------------
$sums = @{}
foreach ($t in $readable) { if ($dumped[$t]) { $r = Sql "CHECKSUM TABLE ``$Database``.``$t``"; if ($r.Code -eq 0) { $sums[$t] = ($r.Out -split "`t" | Select-Object -Last 1).Trim() } } }
Remove-Container; Ok "recovery container removed (the work copy is kept until -Remove)"

# ---- 5b. salvage of damaged / unreadable tables (PARTIAL data, kept apart from the verified core dump) ------------------------------------
# innodb_force_recovery 1-3 lets the server skip damaged pages, so the rows on the healthy pages can still be extracted. The result is
# INCOMPLETE by definition: it goes to its own salvage-*.sql.gz file, is never merged into the core dump, and is flagged partial in the report.
$salvage = @{}
foreach ($t in $needSalvage) {
  Write-Host "`n--- salvage attempt for damaged table '$t' (levels 1-$MaxForce, partial data only)"
  for ($lvl = 1; $lvl -le $MaxForce; $lvl++) {
    $s = Start-Level $lvl
    if (-not $s.Up) { Info "level ${lvl}: server did not start ($($s.Why))"; continue }
    $o = & docker exec $Name sh -c "mariadb-dump --protocol=socket -uroot --force --default-character-set=utf8mb4 --skip-lock-tables --hex-blob $Database $t > /tmp/s.sql 2>/tmp/s.err" 2>&1
    $dumpCode = $LASTEXITCODE
    $hasRows = (& docker exec $Name sh -c "grep -c 'INSERT INTO' /tmp/s.sql" 2>$null | Out-String).Trim()
    $cnt = Sql "SELECT COUNT(*) FROM ``$Database``.``$t``"
    if ($hasRows -match '^[1-9]') {
      & docker exec $Name sh -c "gzip -9 < /tmp/s.sql > /tmp/s.sql.gz" | Out-Null
      $sname = "salvage-$t-L$lvl-$stamp.sql.gz"
      Invoke-Docker cp "${Name}:/tmp/s.sql.gz" "$WorkRoot\out\$sname"
      $ssha = Sha256 "$WorkRoot\out\$sname"; "$ssha  $sname" | Set-Content -Encoding ascii "$WorkRoot\out\$sname.sha256"
      $salvage[$t] = @{ partial = $true; level = $lvl; file = $sname; sha256 = $ssha; rows_visible_at_this_level = $(if ($cnt.Code -eq 0) { $cnt.Out } else { 'unknown' }); dump_exit_code = $dumpCode; note = 'INCOMPLETE: rows on damaged pages are missing; verify ids against the source before importing' }
      Ok "partial salvage of '$t' written: $sname (rows visible at level ${lvl}: $($salvage[$t].rows_visible_at_this_level); expected total is unknown)"
      break
    } else { Info "level ${lvl}: nothing extractable for '$t'" }
  }
  if (-not $salvage.ContainsKey($t)) { $salvage[$t] = @{ partial = $true; file = $null; note = 'nothing could be extracted at any safe level' }; Write-Host "WARNING: nothing could be salvaged for '$t'" -ForegroundColor Yellow }
}
if ($needSalvage.Count -gt 0) { Remove-Container }

# ---- 6. verify by restoring the dump into the isolated restore container ------------------------------------------------------------
$verify = @{}; $verified = $null
if (-not $NoVerify) {
  Write-Host "`n--- fidelity check: restore the dump into an isolated container and compare rows + CHECKSUM TABLE"
  $restore = Join-Path $PSScriptRoot 'restore-legacy-db.ps1'
  $rw = "$WorkRoot\verify-restore"
  & powershell -NoProfile -File $restore -Remove -WorkDir $rw | Out-Null
  $out = & powershell -NoProfile -File $restore -Dump "$WorkRoot\out\$dumpName" -Database $Database -WorkDir $rw -Port $RestorePort -Image $Image 2>&1 | Out-String
  if ($out -notmatch 'importer_ro is SELECT-only') { Write-Host $out; Fail "the verification restore did not complete" }
  $cred = @{}; Get-Content "$rw\credentials.txt" | ForEach-Object { $k, $v = $_ -split '=', 2; $cred[$k] = $v }
  $rc = 'aawraq-legacy-restore'; $allEqual = $true
  foreach ($t in $readable) {
    if (-not $dumped[$t]) { continue }
    $rows = (& docker exec $rc mariadb -uroot "-p$($cred['ROOT_PASSWORD'])" --batch --skip-column-names -e "SELECT COUNT(*) FROM ``$Database``.``$t``" 2>$null | Out-String).Trim()
    $cs = ((& docker exec $rc mariadb -uroot "-p$($cred['ROOT_PASSWORD'])" --batch --skip-column-names -e "CHECKSUM TABLE ``$Database``.``$t``" 2>$null | Out-String).Trim() -split "`t" | Select-Object -Last 1).Trim()
    $eq = ($rows -eq [string]$probe.status[$t].rows) -and ($cs -eq $sums[$t])
    if (-not $eq) { $allEqual = $false }
    $verify[$t] = @{ restored_rows = $rows; restored_checksum = $cs; equal = $eq }
    Info ('{0,-16} recovered {1,8} rows / restored {2,8} rows  checksum {3}' -f $t, $probe.status[$t].rows, $rows, $(if ($eq) { 'EQUAL' } else { 'DIFFERENT' }))
  }
  & powershell -NoProfile -File $restore -Remove -WorkDir $rw | Out-Null
  $verified = $allEqual
  if ($allEqual) { Ok "every extracted table restored with identical row count and checksum" } else { Write-Host "WARNING: the restore differs from the recovered server for at least one table - do not use this dump" -ForegroundColor Yellow }
}

# ---- 7. report -----------------------------------------------------------------------------------------------------------------------
$report = [ordered]@{
  generated = (Get-Date).ToString('s'); source_copy = $src; source_manifest_fingerprint = $manifestSha; source_files = $manifest.Count; database = $Database; image = $Image
  source_version = $want.Text; image_version = $have.Text; recovery_server_version = $serverVersion; other_application_database_folders = $dbDirs.Count   # count only: their names are other-site metadata
  innodb_force_recovery_used = $levelUsed; attempts = $attempts; critical = $Critical
  critical_readable = $(Score @{ status = $probe.status }); dump = $dumpName; dump_sha256 = $dumpSha; sensitive_tables_dumped = ($sens.Count -gt 0)
  tables = ($wanted | ForEach-Object { [ordered]@{ table = $_; state = $probe.status[$_].state; rows = $probe.status[$_].rows; error = $probe.status[$_].error; dumped = [bool]$dumped[$_]; checksum = $sums[$_]; verified = $verify[$_]; salvage = $salvage[$_] } })
  damaged_or_unreadable = $needSalvage
  fidelity_verified = $verified
  not_in_database_folder = @($wanted | Where-Object { $probe.status[$_].state -eq 'absent' })
  all_tables_present = ($probe.present | Sort-Object)
}
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding ascii "$WorkRoot\out\recovery-report-$stamp.json"
Write-Host "`nSUMMARY: level $levelUsed | clean critical tables $($report.critical_readable)/$($Critical.Count) | fidelity verified: $verified | damaged/unreadable: $(if ($needSalvage.Count) { $needSalvage -join ', ' } else { 'none' })"
if ($needSalvage.Count -gt 0) { Write-Host "DAMAGED tables are NOT in the core dump. Partial salvage files (if any) are in $WorkRoot\out\salvage-*.sql.gz and must be reviewed before any import." -ForegroundColor Yellow }
Write-Host "report: $WorkRoot\out\recovery-report-$stamp.json"
Write-Host "next:  powershell -NoProfile -File scripts/migration/restore-legacy-db.ps1 -Dump $WorkRoot\out\$dumpName   then the importer dry-run (docs/implementation/INCREMENTAL_RECOVERY_PLAN.md)"
Write-Host "when finished:  powershell -NoProfile -File scripts/migration/recover-from-datadir.ps1 -Remove -WorkRoot $WorkRoot"
if ($verified -eq $false) { exit 2 }
