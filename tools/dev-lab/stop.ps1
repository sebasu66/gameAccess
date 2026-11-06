[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'GameAccess\dev-lab'
$pidFile = Join-Path $stateRoot 'watcher.pid'
$stopFile = Join-Path $stateRoot 'stop.flag'
$activeAppPidFile = Join-Path $stateRoot 'active-app.pid'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
Set-Content -LiteralPath $stopFile -Value ([DateTime]::UtcNow.ToString('o')) -Encoding ASCII

if (Test-Path -LiteralPath $activeAppPidFile) {
    try {
        $appPid = [int](Get-Content -LiteralPath $activeAppPidFile -Raw).Trim()
        $app = Get-Process -Id $appPid -ErrorAction SilentlyContinue
        if ($app) {
            $null = $app.CloseMainWindow()
            if (-not $app.WaitForExit(4000)) { $app.Kill() }
            Write-Host "Stopped active automated Game Access process (PID $appPid)."
        }
    } catch {}
    Remove-Item -LiteralPath $activeAppPidFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host 'Game Access Dev Lab is not running.'
    exit 0
}

$watcherPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
$watcher = Get-Process -Id $watcherPid -ErrorAction SilentlyContinue
if (-not $watcher) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Game Access Dev Lab was already stopped.'
    exit 0
}

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    $watcher.Refresh()
    if ($watcher.HasExited) { break }
}
if (-not $watcher.HasExited) {
    $watcher.Kill()
    Write-Host "Forced watcher shutdown after graceful stop timeout (PID $watcherPid)."
} else {
    Write-Host "Game Access Dev Lab stopped (PID $watcherPid)."
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
