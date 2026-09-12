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

Write-Host ''
Write-Host '============================================================'
Write-Host ' GAME ACCESS DEV LAB - LIVE WATCHER'
Write-Host '============================================================'
Write-Host "Repository : C:\DEV\Game Access Dev"
Write-Host "Config     : $ConfigPath"
Write-Host "Log        : $stateRoot\watcher.log"
Write-Host 'Mode       : foreground / live output'
Write-Host 'Stop       : Ctrl+C, close this terminal, or run STOP_GAMEACCESS_DEV_LAB.cmd'
Write-Host '============================================================'
Write-Host ''

try {
    & $watcher -ConfigPath $ConfigPath
} catch {
    Write-Host ''
    Write-Host "DEV LAB TERMINATED WITH ERROR: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    Write-Host ''
    Write-Host 'Game Access Dev Lab watcher has stopped.'
}
