$ErrorActionPreference = 'Stop'
$DesktopDir = $PSScriptRoot
$ApiUrl = 'http://127.0.0.1:38147'
$UiPort = 38148

try {
  $health = Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 3
  if (-not $health.ok) { throw 'health returned not-ok' }
} catch {
  throw "GameAccess backend is not ready at $ApiUrl. Start apps/api/run_admin_preview.ps1 first."
}

$listeners = Get-NetTCPConnection -LocalPort $UiPort -State Listen -ErrorAction SilentlyContinue
foreach ($listener in @($listeners)) {
  try { Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Milliseconds 300

$env:VITE_GAMEACCESS_API = $ApiUrl
$log = Join-Path $DesktopDir 'desktop-preview.log'
if (Test-Path $log) { Remove-Item $log -Force }
$cmd = "cd /d `"$DesktopDir`" && set VITE_GAMEACCESS_API=$ApiUrl&& npm.cmd run dev > `"$log`" 2>&1"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',$cmd -WindowStyle Hidden

$baseUrl = "http://127.0.0.1:$UiPort"
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 400
  try {
    $r = Invoke-WebRequest $baseUrl -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  $tail = if (Test-Path $log) { Get-Content $log -Tail 100 | Out-String } else { 'no log' }
  throw "Desktop preview did not start.`n$tail"
}
Start-Process $baseUrl
[pscustomobject]@{ ok=$true; backend=$ApiUrl; frontend=$baseUrl } | ConvertTo-Json -Compress
