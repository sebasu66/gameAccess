[CmdletBinding()]
param([switch]$NoRun)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$desktopRoot = Join-Path $projectRoot 'apps\desktop'
$targetRoot = Join-Path $desktopRoot 'src-tauri\target'
$sourceExe = Join-Path $targetRoot 'release\gameaccess-desktop.exe'
$outputExe = Join-Path $projectRoot 'GameAccess-latest.exe'
$temporaryExe = Join-Path $projectRoot ('GameAccess-build-' + [guid]::NewGuid().ToString('N') + '.tmp')
$backupExe = "$temporaryExe.backup"
$previousTarget = $env:CARGO_TARGET_DIR
$previousStamp = $env:VITE_BUILD_TIMESTAMP
$buildTimestamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

try {
    Get-Command npm.cmd -ErrorAction Stop | Out-Null
    Get-Command cargo -ErrorAction Stop | Out-Null
    Write-Host 'Closing this project app (Steam, games and download workers are not stopped)...'
    $appPaths = @($outputExe, $sourceExe)
    foreach ($appProcess in Get-Process) {
        try { $processPath = $appProcess.Path } catch { continue }
        if (-not $processPath -or $processPath -notin $appPaths) { continue }
        Write-Host "Closing $processPath (PID $($appProcess.Id))"
        $null = $appProcess.CloseMainWindow()
        if (-not $appProcess.WaitForExit(5000)) {
            # Recheck identity before force-closing; never kill by name or process tree.
            $stillRunning = Get-Process -Id $appProcess.Id -ErrorAction SilentlyContinue
            if ($stillRunning -and $stillRunning.Path -eq $processPath -and $stillRunning.StartTime -eq $appProcess.StartTime) {
                $stillRunning.Kill()
                if (-not $stillRunning.WaitForExit(5000)) { throw 'App did not exit.' }
            }
        }
    }
    $env:CARGO_TARGET_DIR = $targetRoot
    $env:VITE_BUILD_TIMESTAMP = $buildTimestamp
    Write-Host "Building Tauri release: $buildTimestamp"
    Push-Location $desktopRoot
    try {
        # Tauri's beforeBuildCommand builds the frontend; no duplicate frontend build.
        & npm.cmd run tauri -- build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw "Tauri build failed (exit $LASTEXITCODE). Previous root executable preserved." }
    } finally { Pop-Location }
    if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) { throw "Missing release: $sourceExe" }
    Copy-Item -LiteralPath $sourceExe -Destination $temporaryExe
    $expectedHash = (Get-FileHash -LiteralPath $sourceExe -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $temporaryExe -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Copied executable hash mismatch.' }
    if (Test-Path -LiteralPath $outputExe) {
        [System.IO.File]::Replace($temporaryExe, $outputExe, $backupExe)
    } else {
        [System.IO.File]::Move($temporaryExe, $outputExe)
    }
    Write-Host "Built: $outputExe"
    Write-Host "Build UTC: $buildTimestamp | SHA256: $expectedHash"
    @{ built_at_utc = $buildTimestamp; source_exe = $sourceExe; output_exe = $outputExe; sha256 = $expectedHash } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'GameAccess-latest.build.json') -Encoding UTF8
    if (-not $NoRun) { Start-Process -FilePath $outputExe -WorkingDirectory $projectRoot -WindowStyle Normal }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:VITE_BUILD_TIMESTAMP = $previousStamp
    if (Test-Path -LiteralPath $temporaryExe) { Remove-Item -LiteralPath $temporaryExe }
    if (Test-Path -LiteralPath $backupExe) { Remove-Item -LiteralPath $backupExe }
}
