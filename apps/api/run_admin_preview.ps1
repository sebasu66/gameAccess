$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$api = Join-Path $root 'apps/api'
$python = Join-Path $api '.venv/Scripts/python.exe'
if (-not (Test-Path $python)) { throw "API venv Python not found: $python" }

$listeners = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
foreach ($listener in @($listeners)) {
  try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Milliseconds 600

$log = Join-Path $api 'admin-preview.log'
if (Test-Path $log) { Remove-Item $log -Force }
$cmd = "cd /d `"$api`" && `"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > `"$log`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',$cmd -WindowStyle Hidden

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 2
    if ($health.ok) { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  $tail = if (Test-Path $log) { Get-Content $log -Tail 100 | Out-String } else { 'no log' }
  throw "API did not start.`n$tail"
}

$overview = Invoke-RestMethod 'http://127.0.0.1:8000/admin-console/overview' -TimeoutSec 10
$html = Invoke-WebRequest 'http://127.0.0.1:8000/admin-console/' -UseBasicParsing -TimeoutSec 10
Start-Process 'http://127.0.0.1:8000/admin-console/'

[pscustomobject]@{
  ok = $true
  health_version = $health.version
  html_status = $html.StatusCode
  accounts = $overview.stats.accounts_total
  seats_available = $overview.stats.accounts_available
  active_games = $overview.stats.active_games
  license_mappings = $overview.stats.license_mappings
  diagnostics = @($overview.diagnostics).Count
  commit = (git -C $root rev-parse HEAD).Trim()
} | ConvertTo-Json -Compress
