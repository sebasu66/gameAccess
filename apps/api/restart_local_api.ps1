param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$api = Join-Path $root 'apps/api'
$python = Join-Path $api '.venv/Scripts/python.exe'
if (-not (Test-Path $python)) { throw "API venv Python not found: $python" }

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in @($listeners)) {
  try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Milliseconds 700

$log = Join-Path $api "local-api-$Port.log"
if (Test-Path $log) { Remove-Item $log -Force }
$cmd = "cd /d `"$api`" && `"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port $Port > `"$log`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',$cmd -WindowStyle Hidden

$baseUrl = "http://127.0.0.1:$Port"
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
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

[pscustomobject]@{
  ok = $true
  port = $Port
  health_version = $health.version
  commit = (git -C $root rev-parse HEAD).Trim()
} | ConvertTo-Json -Compress
