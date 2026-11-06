# Antivirus gate for the quarantine directory (Windows Defender). Writes migration-output\defender-scan.json.
#   powershell -NoProfile -File scripts\migration\scan-quarantine.ps1 [-Path D:\mostqel\aawraq-quarantine\user-files]
# "clean" is true ONLY if the scan completed and Defender reported no detection touching the scanned path.
# If Defender is unavailable/disabled the report says so and clean stays false (staging refuses to run).
param(
  [string]$Path = 'D:\mostqel\aawraq-quarantine\user-files',
  [string]$Out = (Join-Path $PSScriptRoot '..\..\migration-output\defender-scan.json')
)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ path = $Path; clean = $false; engine = 'Windows Defender'; started_at = (Get-Date).ToUniversalTime().ToString('o'); finished_at = $null; detections = @(); note = $null }
try {
  $st = Get-MpComputerStatus
  $result.antivirus_enabled = $st.AntivirusEnabled
  $result.realtime_protection = $st.RealTimeProtectionEnabled
  $result.signatures_updated = $st.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o')
  $result.signature_version = $st.AntivirusSignatureVersion
  if (-not $st.AntivirusEnabled) { throw 'Defender antivirus is disabled' }
  $before = Get-Date
  Start-MpScan -ScanType CustomScan -ScanPath $Path
  $result.finished_at = (Get-Date).ToUniversalTime().ToString('o')
  $hits = @(Get-MpThreatDetection | Where-Object { $_.InitialDetectionTime -ge $before.AddMinutes(-1) -and ($_.Resources -join ' ') -like "*$($Path.TrimEnd('\'))*" })
  $result.detections = @($hits | ForEach-Object { [ordered]@{ threat_id = $_.ThreatID; resources = @($_.Resources); action_success = $_.ActionSuccess } })
  $present = (Get-ChildItem -LiteralPath $Path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
  $result.files_present_after_scan = $present
  $result.clean = ($hits.Count -eq 0)
} catch {
  $result.note = "scan not completed: $($_.Exception.Message)"
  $result.finished_at = (Get-Date).ToUniversalTime().ToString('o')
}
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -Path $Out
Write-Output ($result | ConvertTo-Json -Depth 6)
