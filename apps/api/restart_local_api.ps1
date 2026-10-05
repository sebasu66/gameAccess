param([int]$Port = 8000, [switch]$StopOnly, [switch]$RunProviderProbe)
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
if ($StopOnly) {
  [pscustomobject]@{ ok = $true; stopped = $true; port = $Port } | ConvertTo-Json -Compress
  exit 0
}

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

# Temporary Dev Lab regression probe for the known difficult provider account.
# Uses the existing private dev roster; no credential is placed in argv or logs.
if ($RunProviderProbe -and $Port -eq 38147) {
  $providerId = 'dimariba51'
  $launcher = Join-Path $root 'apps/launcher'
  $launcherPython = Join-Path $launcher '.venv/Scripts/python.exe'
  if (-not (Test-Path $launcherPython)) { $launcherPython = $python }
  $onboardScript = Join-Path $launcher 'provider_account_onboard.py'
  $probeRoot = Join-Path $env:LOCALAPPDATA 'GameAccess/dev-lab'
  New-Item -ItemType Directory -Force -Path $probeRoot | Out-Null
  $probeLog = Join-Path $probeRoot 'provider-import-dimariba51.log'
  $probeResult = Join-Path $probeRoot 'provider-import-dimariba51.json'

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $launcherPython $onboardScript '--api' $baseUrl '--provider-id' $providerId '--timeout-seconds' '150' '--compact' 2>&1 |
      Tee-Object -FilePath $probeLog | ForEach-Object { Write-Host "[PROVIDER-PROBE] $_" }
    $probeExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($probeExit -ne 0) {
    throw "Provider import probe for $providerId failed with exit code $probeExit. See $probeLog"
  }

  $overview = Invoke-RestMethod "$baseUrl/admin-console/overview" -TimeoutSec 30
  $titles = @(
    $overview.licenses |
      Where-Object {
        @($_.owners | Where-Object { ([string]$_.label).Equals($providerId, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
      } |
      ForEach-Object { [string]$_.name } |
      Where-Object { $_ } |
      Sort-Object -Unique
  )
  $robocop = @($titles | Where-Object { $_ -match '(?i)robocop' })
  $dyingLightBeast = @($titles | Where-Object { $_ -match '(?i)dying\s*light.*beast' })
  $missing = @()
  if ($robocop.Count -eq 0) { $missing += 'RoboCop' }
  if ($dyingLightBeast.Count -eq 0) { $missing += 'Dying Light: The Beast' }
  [pscustomobject]@{
    ok = ($missing.Count -eq 0)
    provider_id = $providerId
    catalog_game_count = $titles.Count
    robocop_matches = $robocop
    dying_light_the_beast_matches = $dyingLightBeast
    missing_expected_titles = $missing
    catalog_titles = $titles
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $probeResult -Encoding UTF8

  if ($missing.Count -gt 0) {
    throw "Provider import completed but expected titles are missing: $($missing -join ', '). See $probeResult"
  }
  Write-Host "[PROVIDER-PROBE] dimariba51 import contains RoboCop and Dying Light: The Beast."
}

[pscustomobject]@{
  ok = $true
  port = $Port
  health_version = $health.version
  commit = (git -C $root rev-parse HEAD).Trim()
} | ConvertTo-Json -Compress
