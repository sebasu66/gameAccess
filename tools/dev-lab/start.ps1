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

# Capture the complete visible terminal session. This is deliberately separate
# from watcher.log: the transcript preserves commands, stdout, stderr and
# PowerShell errors exactly as they appeared in the console.
$transcriptStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$transcriptPath = Join-Path $stateRoot ("console-{0}.log" -f $transcriptStamp)
$latestTranscript = Join-Path $stateRoot 'console-latest.log'
$transcriptStarted = $false
try {
    Start-Transcript -LiteralPath $transcriptPath -Force | Out-Null
    $transcriptStarted = $true
} catch {
    Write-Warning "Could not start Dev Lab console transcript: $($_.Exception.Message)"
}

try {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host ' GAME ACCESS DEV LAB - LIVE WATCHER'
    Write-Host '============================================================'
    Write-Host "Repository : C:\DEV\Game Access Dev"
    Write-Host "Config     : $ConfigPath"
    Write-Host "Event log  : $stateRoot\watcher.log"
    Write-Host "Console log: $transcriptPath"
    Write-Host 'Mode       : foreground / live output'
    Write-Host 'Stop       : Ctrl+C, close this terminal, or run STOP_GAMEACCESS_DEV_LAB.cmd'
    Write-Host '============================================================'
    Write-Host ''

    & $watcher -ConfigPath $ConfigPath
} catch {
    Write-Host ''
    Write-Host "DEV LAB TERMINATED WITH ERROR: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    Write-Host ''
    Write-Host 'Game Access Dev Lab watcher has stopped.'
    Write-Host "Full console transcript: $transcriptPath"

    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
    }
    if (Test-Path -LiteralPath $transcriptPath -PathType Leaf) {
        Copy-Item -LiteralPath $transcriptPath -Destination $latestTranscript -Force -ErrorAction SilentlyContinue
    }

    # Keep the evidence bounded while preserving enough history for debugging.
    Get-ChildItem -LiteralPath $stateRoot -Filter 'console-????????-??????.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 10 |
        Remove-Item -Force -ErrorAction SilentlyContinue
}
