[CmdletBinding()]
param(
    [switch]$NoRun,
    [switch]$Server,
    [ValidateRange(1024, 65535)][int]$ServerPort = 38147
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$desktopRoot = Join-Path $projectRoot 'apps\desktop'
$apiRoot = Join-Path $projectRoot 'apps\api'
$apiVenv = Join-Path $apiRoot '.venv'
$apiPython = Join-Path $apiVenv 'Scripts\python.exe'
$apiRequirements = Join-Path $apiRoot 'requirements.txt'
$apiRequirementsStamp = Join-Path $apiVenv '.gameaccess-requirements.sha256'
$apiRestartScript = Join-Path $apiRoot 'restart_local_api.ps1'
$targetRoot = Join-Path $desktopRoot 'src-tauri\target'
$sourceExe = Join-Path $targetRoot 'release\gameaccess-desktop.exe'
$outputExe = Join-Path $projectRoot 'GameAccess-latest.exe'
$temporaryExe = Join-Path $projectRoot ('GameAccess-build-' + [guid]::NewGuid().ToString('N') + '.tmp')
$backupExe = "$temporaryExe.backup"
$previousTarget = $env:CARGO_TARGET_DIR
$previousStamp = $env:VITE_BUILD_TIMESTAMP
$previousApi = $env:VITE_GAMEACCESS_API
$buildTimestamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$localApiUrl = "http://127.0.0.1:$ServerPort"
$logBase = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'GameAccess\logs' } else { Join-Path $env:TEMP 'GameAccess\logs' }
$activityLog = Join-Path $logBase 'gameaccess.log'
$tailHelperPs1 = Join-Path $projectRoot 'tools\windows\tail.ps1'
$tailHelperCmd = Join-Path $projectRoot 'tools\windows\tail.cmd'
$sebaToolsRoot = 'C:\SebaSU_Tools' 

function Write-GameAccessNarration {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$Area = 'BUILD',
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    New-Item -ItemType Directory -Force -Path $logBase | Out-Null
    $stamp = [DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')
    Add-Content -LiteralPath $activityLog -Value "$stamp [$Level] [$Area] $Message" -Encoding UTF8
}

function Install-SebaSUTailHelper {
    try {
        New-Item -ItemType Directory -Force -Path $sebaToolsRoot | Out-Null
        Copy-Item -LiteralPath $tailHelperPs1 -Destination (Join-Path $sebaToolsRoot 'tail.ps1') -Force
        Copy-Item -LiteralPath $tailHelperCmd -Destination (Join-Path $sebaToolsRoot 'tail.cmd') -Force
        Write-GameAccessNarration "Installed generic live-tail helper at C:\SebaSU_Tools\tail.ps1 and tail.cmd." 'TOOLS'
    } catch {
        Write-Warning "Could not install C:\SebaSU_Tools tail helper: $($_.Exception.Message)"
        Write-GameAccessNarration "Could not install the C:\SebaSU_Tools tail helper: $($_.Exception.Message)" 'TOOLS' 'WARN'
    }
}

function Get-SystemPythonCommand {
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { return @{ File = $py.Source; Prefix = @('-3') } }
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) { return @{ File = $python.Source; Prefix = @() } }
    throw 'Python 3 is required to prepare the GameAccess server build.'
}

function Ensure-ServerBuild {
    if (-not (Test-Path -LiteralPath $apiPython -PathType Leaf)) {
        $hostPython = Get-SystemPythonCommand
        $venvArgs = @($hostPython.Prefix) + @('-m', 'venv', $apiVenv)
        Write-Host "Creating API virtual environment: $apiVenv"
        & $hostPython.File @venvArgs
        if ($LASTEXITCODE -ne 0) { throw "Could not create API virtual environment (exit $LASTEXITCODE)." }
    }

    $requirementsHash = (Get-FileHash -LiteralPath $apiRequirements -Algorithm SHA256).Hash
    $installedHash = if (Test-Path -LiteralPath $apiRequirementsStamp) { (Get-Content -LiteralPath $apiRequirementsStamp -Raw).Trim() } else { '' }
    if ($installedHash -ne $requirementsHash) {
        Write-Host 'Installing/updating GameAccess server dependencies...'
        & $apiPython -m pip install --disable-pip-version-check -r $apiRequirements
        if ($LASTEXITCODE -ne 0) { throw "Server dependency installation failed (exit $LASTEXITCODE)." }
        Set-Content -LiteralPath $apiRequirementsStamp -Value $requirementsHash -Encoding ASCII
    }

    Write-Host 'Compiling and importing GameAccess FastAPI server...'
    Push-Location $apiRoot
    try {
        & $apiPython -m compileall -q app
        if ($LASTEXITCODE -ne 0) { throw "Server source compilation failed (exit $LASTEXITCODE)." }
        & $apiPython -c "from app.main import app; assert app.title == 'gameAccess API'"
        if ($LASTEXITCODE -ne 0) { throw "Server import validation failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
    return $requirementsHash
}

try {
    Get-Command npm.cmd -ErrorAction Stop | Out-Null
    Get-Command cargo -ErrorAction Stop | Out-Null

    Write-GameAccessNarration "Build-and-run started. Preparing the GameAccess server and desktop client. Build timestamp: $buildTimestamp."
    Write-Host "Preparing GameAccess server build: $buildTimestamp"
    $serverRequirementsHash = Ensure-ServerBuild
    Write-GameAccessNarration "GameAccess server source compiled and imported successfully; server dependencies are ready." "SERVER"

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
    if ($Server) {
        # A -Server build is intentionally pinned to the local API even if the
        # packaged runtime settings normally resolve to a hosted backend.
        $env:VITE_GAMEACCESS_API = $localApiUrl
    }

    Write-GameAccessNarration "Starting production build of the GameAccess desktop front end." "FRONTEND"
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

    Write-Host "Built client: $outputExe"
    Write-GameAccessNarration "Desktop client build completed successfully: $outputExe." "FRONTEND"
    Install-SebaSUTailHelper
    Write-Host "Server source validated: apps/api/app.main:app | requirements SHA256: $serverRequirementsHash"
    Write-Host "Build UTC: $buildTimestamp | client SHA256: $expectedHash"
    @{
        built_at_utc = $buildTimestamp
        source_exe = $sourceExe
        output_exe = $outputExe
        sha256 = $expectedHash
        server = @{
            app = 'apps/api/app.main:app'
            requirements_sha256 = $serverRequirementsHash
            local_url = if ($Server) { $localApiUrl } else { $null }
        }
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $projectRoot 'GameAccess-latest.build.json') -Encoding UTF8

    if (-not $NoRun -and $Server) {
        Write-Host "Starting local GameAccess server at $localApiUrl"
        Write-GameAccessNarration "Starting local GameAccess backend server at $localApiUrl." "SERVER"
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $apiRestartScript -Port $ServerPort
        if ($LASTEXITCODE -ne 0) { throw "Local server failed to start (exit $LASTEXITCODE)." }
        Write-GameAccessNarration "Local GameAccess backend server is ready at $localApiUrl." "SERVER"
    }
    if (-not $NoRun) {
        Write-GameAccessNarration "Starting the GameAccess desktop front end executable." "FRONTEND"
        Start-Process -FilePath $outputExe -WorkingDirectory $projectRoot -WindowStyle Normal
    }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:VITE_BUILD_TIMESTAMP = $previousStamp
    $env:VITE_GAMEACCESS_API = $previousApi
    if (Test-Path -LiteralPath $temporaryExe) { Remove-Item -LiteralPath $temporaryExe }
    if (Test-Path -LiteralPath $backupExe) { Remove-Item -LiteralPath $backupExe }
}
