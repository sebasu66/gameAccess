[CmdletBinding()]
param([string]$ConfigPath = '')

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptRoot 'config.json' }
$stateRoot = Join-Path $env:LOCALAPPDATA 'GameAccess\dev-lab'
$pidFile = Join-Path $stateRoot 'watcher.pid'
$stopFile = Join-Path $stateRoot 'stop.flag'
$watcher = Join-Path $scriptRoot 'watch.ps1'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

if (Test-Path -LiteralPath $pidFile) {
    $existingPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $existing = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Game Access Dev Lab is already running (PID $existingPid)."
        exit 0
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
$argumentLine = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$watcher`" -ConfigPath `"$ConfigPath`""
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentLine -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII
Write-Host "Game Access Dev Lab started (PID $($process.Id))."
Write-Host "Watching origin/dev. Log: $stateRoot\watcher.log"
