[CmdletBinding()]
param()

$stateRoot = Join-Path $env:LOCALAPPDATA 'GameAccess\dev-lab'
$pidFile = Join-Path $stateRoot 'watcher.pid'
$stateFile = Join-Path $stateRoot 'state.json'
$watcherLog = Join-Path $stateRoot 'watcher.log'

$running = $false
$watcherPid = $null
if (Test-Path -LiteralPath $pidFile) {
    try {
        $watcherPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
        $running = [bool](Get-Process -Id $watcherPid -ErrorAction SilentlyContinue)
    } catch {}
}

Write-Host ("Game Access Dev Lab: {0}" -f $(if ($running) { "RUNNING (PID $watcherPid)" } else { 'STOPPED' }))
if (Test-Path -LiteralPath $stateFile) {
    try {
        $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        Write-Host "Last processed: $($state.last_processed_sha)"
        Write-Host "Last passed:    $($state.last_passed_sha)"
        Write-Host "Last run:       $($state.last_run)"
    } catch {}
}
if (Test-Path -LiteralPath $watcherLog) {
    Write-Host "Log: $watcherLog"
    Get-Content -LiteralPath $watcherLog -Tail 8
}
