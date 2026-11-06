# The ISOLATED local Supabase stack for REAL recovered data. It is a second, separate stack: own project id (aawraq-recovery), own ports
# (the dev ports + 1000), own Docker volumes, NO seed data, its own environment file (.env.recovery, git-ignored). It never touches the
# everyday dev stack (project aawraq-local, ports 54320-54329) and never mixes with its 100+ synthetic books and 300+ test users.
#
#   powershell -NoProfile -File scripts/recovery/recovery-stack.ps1 -Action Init     # create the work directory + config + migrations (no containers yet)
#   powershell -NoProfile -File scripts/recovery/recovery-stack.ps1 -Action Start    # start the stack, apply the migrations, write .env.recovery
#   powershell -NoProfile -File scripts/recovery/recovery-stack.ps1 -Action Status   # isolation + emptiness report (read-only)
#   powershell -NoProfile -File scripts/recovery/recovery-stack.ps1 -Action Stop     # stop ONLY this stack; its data volumes are kept
#
# Deliberately NOT used anywhere here: `supabase stop --all` (would stop the dev stack) and `--no-backup` (deletes data volumes).
param(
  [Parameter(Mandatory = $true)][ValidateSet('Init', 'Start', 'Stop', 'Status')][string]$Action,
  [string]$WorkDir = 'D:\mostqel\aawraq-recovery-stack'
)
# 'Continue' on purpose: Windows PowerShell 5.1 turns any native stderr line into a terminating error under 'Stop'; exit codes are checked explicitly.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProjectId = 'aawraq-recovery'
$DevProjectId = 'aawraq-local'
$PortShift = 1000
$Exclude = 'realtime,imgproxy,edge-runtime,logflare,vector,studio,mailpit'   # the same lean set as the dev stack, minus UI extras
function Fail($m) { Write-Host "REFUSING: $m" -ForegroundColor Red; exit 1 }
function Ok($m) { Write-Host "ok    $m" -ForegroundColor Green }
function Info($m) { Write-Host "      $m" }
function Sb { Push-Location $repo; try { & npx.cmd supabase @args } finally { Pop-Location } }
function DevContainers { @(& docker ps --format '{{.Names}}' | Where-Object { $_ -like "*_$DevProjectId" }) }
function RecContainers { @(& docker ps --format '{{.Names}}' | Where-Object { $_ -like "*_$ProjectId" }) }

if ($WorkDir -notmatch 'recovery') { Fail "the work directory name must contain 'recovery' ($WorkDir): it must never be the dev project directory" }
if ((Resolve-Path -LiteralPath $repo).Path -eq $WorkDir) { Fail "the work directory cannot be the repository" }
$cfgPath = Join-Path $WorkDir 'supabase\config.toml'

switch ($Action) {
  'Init' {
    $devCfg = Get-Content -Raw -LiteralPath (Join-Path $repo 'supabase\config.toml')
    if ($devCfg -notmatch "project_id\s*=\s*`"$DevProjectId`"") { Fail "the repository config does not declare project_id $DevProjectId; refusing to derive from an unknown config" }
    New-Item -ItemType Directory -Force -Path (Join-Path $WorkDir 'supabase\migrations') | Out-Null
    $c = $devCfg -replace "project_id\s*=\s*`"$DevProjectId`"", "project_id = `"$ProjectId`""
    # shift every port by +1000 so the two stacks can run side by side
    $c = [regex]::Replace($c, '(?m)^(\s*(?:port|shadow_port)\s*=\s*)(\d+)(\s*(?:#.*)?)$', { param($m) $m.Groups[1].Value + ([int]$m.Groups[2].Value + $PortShift) + $m.Groups[3].Value })
    # NO seed data in the recovery stack
    $c = [regex]::Replace($c, '(?ms)(\[db\.seed\].*?enabled\s*=\s*)true', '${1}false')
    Set-Content -Encoding ascii -LiteralPath $cfgPath -Value $c
    $copied = 0; foreach ($f in Get-ChildItem (Join-Path $repo 'supabase\migrations') -Filter '*.sql') { Copy-Item $f.FullName (Join-Path $WorkDir 'supabase\migrations') -Force; $copied++ }
    $ports = [regex]::Matches($c, '(?m)^\s*(?:port|shadow_port)\s*=\s*(\d+)') | ForEach-Object { $_.Groups[1].Value }
    Ok "recovery stack initialised in $WorkDir (project $ProjectId, $copied migrations copied, seed disabled)"
    Info "ports: $($ports -join ', ')  (dev stack: 54320-54329)"
    $dupe = @($ports | Where-Object { [int]$_ -ge 54320 -and [int]$_ -le 54329 })
    if ($dupe.Count) { Fail "port collision with the dev stack: $($dupe -join ', ')" }
    Info "next: -Action Start"
  }
  'Start' {
    if (-not (Test-Path $cfgPath)) { Fail "not initialised: run -Action Init first" }
    $before = DevContainers
    if ($before.Count -eq 0) { Info "note: the dev stack is not running (that is fine; it is not touched either way)" }
    Info "starting the recovery stack (first start pulls nothing new; applying migrations takes a minute)..."
    $out = Sb start --workdir $WorkDir -x $Exclude 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Host $out; Fail "supabase start failed" }
    Ok "recovery stack started: $((RecContainers) -join ', ')"
    $after = DevContainers
    if (($after.Count -ne $before.Count)) { Fail "the number of dev containers changed ($($before.Count) -> $($after.Count)) - investigate before continuing" }
    Ok "the dev stack is untouched ($($after.Count) containers still running)"
    # environment file for the migration scripts and the app (git-ignored; keys never printed)
    $st = Sb status -o env --workdir $WorkDir 2>$null | Out-String
    $kv = @{}; foreach ($l in ($st -split "`r?`n")) { if ($l -match '^([A-Z0-9_]+)="?(.*?)"?$') { $kv[$Matches[1]] = $Matches[2] } }
    $url = $kv['API_URL']; $anon = if ($kv['PUBLISHABLE_KEY']) { $kv['PUBLISHABLE_KEY'] } else { $kv['ANON_KEY'] }; $svc = if ($kv['SECRET_KEY']) { $kv['SECRET_KEY'] } else { $kv['SERVICE_ROLE_KEY'] }
    if (-not $url -or -not $anon -or -not $svc) { Fail "could not read the stack's API URL / keys from 'supabase status'" }
    if ($url -notmatch '^http://127\.0\.0\.1:5[5-9]\d\d\d$') { Fail "unexpected recovery API URL $url" }
    $envFile = Join-Path $repo '.env.recovery'
    @("# ISOLATED recovery stack for REAL recovered data. Git-ignored. Created by scripts/recovery/recovery-stack.ps1.", "AAWRAQ_STACK=recovery", "NUXT_PUBLIC_SUPABASE_URL=$url", "NUXT_PUBLIC_SUPABASE_KEY=$anon", "NUXT_SUPABASE_SECRET_KEY=$svc",
      "NUXT_PUBLIC_SITE_URL=http://127.0.0.1:3100", "NUXT_ALLOW_DEV_PAYMENT_SIMULATOR=false", "NUXT_MEDIA_ENABLED_PROVIDERS=external") | Set-Content -Encoding ascii -LiteralPath $envFile
    Ok ".env.recovery written ($url)"
  }
  'Stop' {
    if (-not (Test-Path $cfgPath)) { Fail "not initialised" }
    $before = DevContainers
    $out = Sb stop --workdir $WorkDir --project-id $ProjectId 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Host $out; Fail "supabase stop failed" }
    Ok "recovery stack stopped (data volumes kept)"
    if ((DevContainers).Count -ne $before.Count) { Fail "dev containers changed during stop - investigate" } else { Ok "the dev stack is untouched ($($before.Count) containers)" }
  }
  'Status' {
    $dev = DevContainers; $rec = RecContainers
    Write-Host "dev stack ($DevProjectId):      $($dev.Count) containers running"
    Write-Host "recovery stack ($ProjectId): $($rec.Count) containers running"
    $envFile = Join-Path $repo '.env.recovery'
    if (-not (Test-Path $envFile)) { Info ".env.recovery does not exist yet"; break }
    $e = @{}; Get-Content $envFile | ForEach-Object { if ($_ -match '^([A-Z0-9_]+)=(.*)$') { $e[$Matches[1]] = $Matches[2] } }
    Write-Host "recovery API: $($e['NUXT_PUBLIC_SUPABASE_URL'])   stack marker: $($e['AAWRAQ_STACK'])"
    if ($rec.Count -gt 0) {
      $db = (& docker ps --format '{{.Names}}' | Where-Object { $_ -eq "supabase_db_$ProjectId" })
      if ($db) {
        $q = "select (select count(*) from public.books) books, (select count(*) from public.books where is_demo or provenance='demo') demo_books, (select count(*) from auth.users) users, (select count(*) from auth.users where email like '%@aawraq.test') test_users, (select count(*) from public.categories) categories, (select count(*) from public.makers) makers, (select count(*) from supabase_migrations.schema_migrations) migrations"
        $r = (& docker exec $db psql -U postgres -At -F ' | ' -c $q 2>&1 | Out-String).Trim()
        Write-Host "recovery database (books | demo books | users | test users | categories | makers | migrations): $r"
      }
    }
  }
}
