# Restore a legacy AAWRAQ MariaDB dump into an ISOLATED, throw-away local container. Never contacts the VPS, never touches Supabase.
#
#   powershell -NoProfile -File scripts/migration/restore-legacy-db.ps1 -Dump D:\mostqel\aawraq-quarantine\db\aawraq.sql.gz
#   (optional) -Database aawraq  -WorkDir D:\mostqel\aawraq-legacy-restore  -Port 33306  -Image mariadb:10.6  -Remove
#
# Guards: dump type is sniffed (a PHP/HTML/executable disguised as a dump is refused); the container binds to 127.0.0.1 ONLY (verified
# after start); data lives on the work drive (not Docker's C: volume); passwords are generated, kept in <WorkDir>\credentials.txt (outside
# the repository) and never printed; the importer gets a SELECT-only account (verified: a write attempt must fail); an existing container
# is never overwritten. -Remove deletes the container and its data when the import work is finished.
param(
  [string]$Dump,
  [string]$Database = 'aawraq',
  [string]$WorkDir = 'D:\mostqel\aawraq-legacy-restore',
  [int]$Port = 33306,
  [string]$Image = 'mariadb:10.6',
  [switch]$Remove
)
# 'Continue' on purpose: Windows PowerShell 5.1 turns ANY native stderr line into a terminating error under 'Stop' (e.g. while MariaDB is still starting).
# Every native call below is checked through $LASTEXITCODE and fails explicitly instead.
$ErrorActionPreference = 'Continue'
$Name = 'aawraq-legacy-restore'
function Fail($m) { Write-Host "REFUSING: $m" -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host "ok    $m" -ForegroundColor Green }
function Invoke-Docker { & docker.exe @args; if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed ($LASTEXITCODE)" } }

if ($Remove) {
  $exists = (& docker ps -a --filter "name=^$Name$" --format '{{.Names}}')
  if ($exists) { & docker rm -f $Name | Out-Null; Ok "container $Name removed" } else { Write-Host "no container $Name" }
  if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir; Ok "work directory $WorkDir removed (data + credentials)" }
  exit 0
}

# ---- 1. the dump ------------------------------------------------------------------------------------------------------------------
if (-not $Dump -or -not (Test-Path -LiteralPath $Dump -PathType Leaf)) { Fail "-Dump <file> is required and must exist" }
if ($Database -notmatch '^[A-Za-z0-9_]{1,64}$') { Fail "-Database must be a plain identifier" }
if ($Dump -match '\.\.') { Fail "path must not contain '..'" }
$item = Get-Item -LiteralPath $Dump
if ($item.Length -lt 200) { Fail "dump is implausibly small ($($item.Length) bytes)" }
$fs = [System.IO.File]::OpenRead($item.FullName); $buf = New-Object byte[] 4096; $n = $fs.Read($buf, 0, 4096); $fs.Close()
$gz = ($buf[0] -eq 0x1f -and $buf[1] -eq 0x8b)
if ($gz) { if ($item.Name -notmatch '\.gz$') { Fail "gzip data without a .gz extension" } }
else {
  if ($item.Name -notmatch '\.sql$') { Fail "only .sql and .sql.gz are accepted (got $($item.Name))" }
  $head = [System.Text.Encoding]::UTF8.GetString($buf, 0, $n)
  if ($head -match '^\s*(<\?php|<html|<!DOCTYPE|MZ|#!)' -or $buf[0] -eq 0x7f -or ($buf[0] -eq 0x4d -and $buf[1] -eq 0x5a)) { Fail "file starts like a script/HTML/executable, not an SQL dump" }
  if ($head -notmatch '(?i)(mysql dump|mariadb dump|create table|insert into|set names|/\*!\d+)') { Fail "no SQL dump markers in the first 4 KB" }
}
Ok "dump accepted: $($item.Name) ($([math]::Round($item.Length/1MB,1)) MiB, $(if ($gz) {'gzip'} else {'plain SQL'}))"
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLower(); Write-Host "      sha256 $sha"

# ---- 2. disk and container guards -------------------------------------------------------------------------------------------------
$drive = (Split-Path -Qualifier (New-Item -ItemType Directory -Force -Path $WorkDir).FullName)
$free = (Get-PSDrive ($drive.TrimEnd(':'))).Free
$need = $item.Length * 4
if ($free -lt $need) { Fail "work drive $drive has $([math]::Round($free/1GB,1)) GiB free, need about $([math]::Round($need/1GB,1)) GiB (4x the dump)" }
Ok "work drive $drive has $([math]::Round($free/1GB,1)) GiB free"
if (& docker ps -a --filter "name=^$Name$" --format '{{.Names}}') { Fail "container $Name already exists; it is never overwritten. Inspect it, or run with -Remove when its work is finished" }
if (Test-Path "$WorkDir\data\*") { Fail "$WorkDir\data is not empty; refusing to reuse a data directory" }

# ---- 3. credentials (generated, stored outside the repo, never printed) -----------------------------------------------------------
function NewSecret { $b = New-Object byte[] 24; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', 'x') }
$root = NewSecret; $ro = NewSecret
New-Item -ItemType Directory -Force -Path "$WorkDir\data" | Out-Null
@("ROOT_PASSWORD=$root", "IMPORTER_USER=importer_ro", "IMPORTER_PASSWORD=$ro", "DATABASE=$Database", "HOST=127.0.0.1", "PORT=$Port") | Set-Content -Encoding ascii "$WorkDir\credentials.txt"
Ok "credentials written to $WorkDir\credentials.txt (not printed)"

# ---- 4. container, loopback only (the data is disposable, so durability settings are relaxed to make a large import fast)
# ---- 4. container, loopback only --------------------------------------------------------------------------------------------------
Invoke-Docker run -d --name $Name -p "127.0.0.1:${Port}:3306" -v "${WorkDir}\data:/var/lib/mysql" -e "MARIADB_ROOT_PASSWORD=$root" $Image --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --innodb-flush-log-at-trx-commit=2 --innodb-doublewrite=0 --skip-log-bin | Out-Null
$bind = (& docker port $Name 3306/tcp) -join ' '
if ($bind -notmatch '127\.0\.0\.1:') { & docker rm -f $Name | Out-Null; Fail "container is not bound to loopback ($bind)" }
Ok "bound to loopback only: $bind"
# NOTE: the host argument must be quoted - Windows PowerShell 5.1 splits an unquoted -h127.0.0.1 at the first dot (host '127').
# TCP login on purpose: the official image first runs a temporary init server (socket only, and 'mariadb-admin ping' succeeds even when access is denied), then restarts as the real server.
$ready = $false
for ($i = 0; $i -lt 300; $i++) { & docker exec $Name mariadb --protocol=tcp "-h127.0.0.1" -uroot "-p$root" -e "SELECT 1" 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $ready = $true; break }; if ($i -gt 0 -and $i % 15 -eq 0) { Write-Host "      ...still starting ($($i*2) s; the first start on a Windows bind mount can take several minutes)" }; Start-Sleep -Seconds 2 }
if (-not $ready) { Fail "MariaDB did not become ready in 10 minutes (see: docker logs $Name)" }
Ok "MariaDB is ready"

# ---- 5. import (docker cp + in-container read: no PowerShell re-encoding of Arabic text) -------------------------------------------
function Sql($query, [switch]$Quiet) { $out = & docker exec $Name mariadb -uroot "-p$root" --batch --skip-column-names -e $query 2>&1; if ($LASTEXITCODE -ne 0) { throw "SQL failed: $out" }; $out }
Sql "CREATE DATABASE ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" | Out-Null
$remote = if ($gz) { '/tmp/dump.sql.gz' } else { '/tmp/dump.sql' }
Invoke-Docker cp $item.FullName "${Name}:$remote"
$cmd = if ($gz) { "zcat $remote | mariadb -uroot -p`"`$MARIADB_ROOT_PASSWORD`" --default-character-set=utf8mb4 $Database" } else { "mariadb -uroot -p`"`$MARIADB_ROOT_PASSWORD`" --default-character-set=utf8mb4 $Database < $remote" }
$t0 = Get-Date
$imp = & docker exec $Name sh -c $cmd 2>&1
if ($LASTEXITCODE -ne 0) { Write-Host $imp; Fail "import failed (the container is left for inspection: docker logs $Name; remove with -Remove)" }
& docker exec $Name rm -f $remote | Out-Null
Ok "import finished in $([math]::Round(((Get-Date) - $t0).TotalSeconds,1)) s"

# ---- 6. SELECT-only account, proven --------------------------------------------------------------------------------------------------
Sql "CREATE USER 'importer_ro'@'%' IDENTIFIED BY '$ro'; GRANT SELECT ON ``$Database``.* TO 'importer_ro'@'%'; FLUSH PRIVILEGES;" | Out-Null
$w = & docker exec $Name mariadb -uimporter_ro "-p$ro" -e "CREATE TABLE ``$Database``.__write_probe (x int)" 2>&1
if ($LASTEXITCODE -eq 0) { Fail "the importer account CAN write - aborting (remove with -Remove)" }
Ok "importer_ro is SELECT-only (a write attempt was refused)"

# ---- 7. what was restored --------------------------------------------------------------------------------------------------------------
Write-Host "`nRestored tables (exact row counts):"
$tables = (Sql "SELECT table_name FROM information_schema.tables WHERE table_schema='$Database' AND table_type='BASE TABLE' ORDER BY table_name") -split "`n" | Where-Object { $_ }
foreach ($t in $tables) { $c = (Sql "SELECT COUNT(*) FROM ``$Database``.``$t``").Trim(); '{0,-28} {1,10}' -f $t, $c }
Write-Host ("`ncharset/collation per table: " + ((Sql "SELECT DISTINCT table_collation FROM information_schema.tables WHERE table_schema='$Database'") -replace "`r?`n", ', '))
Write-Host "`nNext (importer env; read the password from $WorkDir\credentials.txt, do not paste it anywhere):"
Write-Host "  LEGACY_DB_HOST=127.0.0.1  LEGACY_DB_PORT=$Port  LEGACY_DB_NAME=$Database  LEGACY_DB_USER=importer_ro  LEGACY_DB_PASSWORD=<from credentials.txt>"
Write-Host "  node scripts/migration/import-legacy.mjs --dump <file> --dry-run"
Write-Host "When the import work is finished:  powershell -NoProfile -File scripts/migration/restore-legacy-db.ps1 -Remove"
