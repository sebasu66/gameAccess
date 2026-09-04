$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$api = Join-Path $root 'apps/api'
$python = Join-Path $api '.venv/Scripts/python.exe'
$port = 38147
if (-not (Test-Path $python)) { throw "API venv Python not found: $python" }

if (-not $env:GAMEACCESS_ACCOUNTS_FILE) {
  $localAccounts = Join-Path $root 'accFull.csv'
  if (Test-Path $localAccounts) {
    $env:GAMEACCESS_ACCOUNTS_FILE = $localAccounts
  } else {
    $siblingAccounts = Join-Path (Split-Path -Parent $root) 'gameAccess/accFull.csv'
    if (Test-Path $siblingAccounts) { $env:GAMEACCESS_ACCOUNTS_FILE = $siblingAccounts }
  }
}

$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in @($listeners)) {
  try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Milliseconds 600

$log = Join-Path $api 'admin-preview.log'
if (Test-Path $log) { Remove-Item $log -Force }
$cmd = "cd /d `"$api`" && `"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port $port > `"$log`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',$cmd -WindowStyle Hidden

$baseUrl = "http://127.0.0.1:$port"
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod "$baseUrl/health" -TimeoutSec 2
    if ($health.ok) { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  $tail = if (Test-Path $log) { Get-Content $log -Tail 100 | Out-String } else { 'no log' }
  throw "API did not start.`n$tail"
}

$overview = Invoke-RestMethod "$baseUrl/admin-console/overview" -TimeoutSec 10
$html = Invoke-WebRequest "$baseUrl/admin-console/" -UseBasicParsing -TimeoutSec 10
Start-Process "$baseUrl/admin-console/"

[pscustomobject]@{
  ok = $true
  port = $port
  health_version = $health.version
  html_status = $html.StatusCode
  accounts = $overview.stats.accounts_total
  seats_available = $overview.stats.accounts_available
  active_games = $overview.stats.active_games
  license_mappings = $overview.stats.license_mappings
  diagnostics = @($overview.diagnostics).Count
  commit = (git -C $root rev-parse HEAD).Trim()
} | ConvertTo-Json -Compress
