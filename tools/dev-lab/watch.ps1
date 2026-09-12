[CmdletBinding()]
param(
    [string]$ConfigPath = ''
)

$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptRoot 'config.json' }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$repoRoot = [IO.Path]::GetFullPath([string]$config.repo_root)
$branch = [string]$config.branch
$pollSeconds = [Math]::Max(5, [int]$config.poll_seconds)
$stateRoot = Join-Path $env:LOCALAPPDATA 'GameAccess\dev-lab'
$runsRoot = Join-Path $stateRoot 'runs'
$bundlesRoot = Join-Path $stateRoot 'bundles'
$stateFile = Join-Path $stateRoot 'state.json'
$stopFile = Join-Path $stateRoot 'stop.flag'
$watcherLog = Join-Path $stateRoot 'watcher.log'
$pidFile = Join-Path $stateRoot 'watcher.pid'
$activeAppPidFile = Join-Path $stateRoot 'active-app.pid'
$gameAccessLog = Join-Path $env:LOCALAPPDATA 'GameAccess\logs\gameaccess.log'

New-Item -ItemType Directory -Force -Path $stateRoot, $runsRoot, $bundlesRoot | Out-Null
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII
Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue

function Write-LabLog([string]$Message, [string]$Level = 'INFO') {
    $line = '{0} [{1}] {2}' -f ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')), $Level, $Message
    Add-Content -LiteralPath $watcherLog -Value $line -Encoding UTF8
}

function Git([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
    $output = & git -C $repoRoot @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
    return @($output)
}

function Load-State {
    if (-not (Test-Path -LiteralPath $stateFile)) {
        return [ordered]@{ last_processed_sha = ''; last_passed_sha = ''; last_run = $null }
    }
    try { return Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json }
    catch { return [ordered]@{ last_processed_sha = ''; last_passed_sha = ''; last_run = $null } }
}

function Save-State($State) {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

function Invoke-Step {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$File,
        [string[]]$Arguments,
        [string]$RunDirectory,
        [System.Collections.Generic.List[object]]$Steps
    )
    $started = [DateTime]::UtcNow
    $logPath = Join-Path $RunDirectory ("step-{0}.log" -f $Name)
    $exitCode = 0
    try {
        Push-Location $WorkingDirectory
        try {
            $global:LASTEXITCODE = 0
            $output = & $File @Arguments 2>&1
            $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
            @($output) | Out-File -LiteralPath $logPath -Encoding utf8
        } finally {
            Pop-Location
        }
    } catch {
        $_ | Out-String | Out-File -LiteralPath $logPath -Encoding utf8
        $exitCode = 1
    }
    $entry = [ordered]@{
        name = $Name
        started_at = $started.ToString('o')
        finished_at = [DateTime]::UtcNow.ToString('o')
        exit_code = $exitCode
        log = $logPath
    }
    $Steps.Add([pscustomobject]$entry)
    if ($exitCode -ne 0) {
        Write-LabLog "Step '$Name' failed with exit code $exitCode." 'ERROR'
        return $false
    }
    Write-LabLog "Step '$Name' passed."
    return $true
}

function Sanitize-TextFile([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return }
    $text = Get-Content -LiteralPath $Source -Raw -ErrorAction SilentlyContinue
    if ($null -eq $text) { return }
    if ($env:USERPROFILE) { $text = $text.Replace($env:USERPROFILE, '%USERPROFILE%') }
    $text = [regex]::Replace($text, '(?i)\b(gh[pousr]_[A-Za-z0-9_]+)\b', '[REDACTED_GITHUB_TOKEN]')
    $text = [regex]::Replace($text, '(?i)(password\s*[=:]\s*)\S+', '$1[REDACTED]')
    Set-Content -LiteralPath $Destination -Value $text -Encoding UTF8
}

function Ensure-DevLabRelease {
    if (-not [bool]$config.upload) { return $false }
    & gh release view ([string]$config.release_tag) --repo ([string]$config.github_repo) *> $null
    if ($LASTEXITCODE -eq 0) { return $true }
    & gh release create ([string]$config.release_tag) --repo ([string]$config.github_repo) --target $branch --prerelease --title 'Game Access Dev Lab' --notes 'Automated local Windows validation evidence. Assets are rotated to the most recent runs.' *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-LabLog 'Could not create dev-lab GitHub release. Evidence remains local.' 'ERROR'
        return $false
    }
    return $true
}

function Publish-Run {
    param([string]$RunDirectory, [string]$Commit, [string]$RunStamp)
    if (-not (Ensure-DevLabRelease)) { return }

    $prefix = "run-$RunStamp-$($Commit.Substring(0, 8))"
    $stage = Join-Path $RunDirectory 'upload'
    New-Item -ItemType Directory -Force -Path $stage | Out-Null

    $summary = Join-Path $RunDirectory 'summary.json'
    if (Test-Path $summary) { Copy-Item $summary (Join-Path $stage "$prefix--summary.json") -Force }
    $automationResult = Join-Path $RunDirectory 'automation\result.json'
    if (Test-Path $automationResult) { Copy-Item $automationResult (Join-Path $stage "$prefix--automation-result.json") -Force }
    $safeLog = Join-Path $RunDirectory 'gameaccess.sanitized.log'
    if (Test-Path $safeLog) { Copy-Item $safeLog (Join-Path $stage "$prefix--gameaccess.log") -Force }

    $shotIndex = 0
    Get-ChildItem -LiteralPath (Join-Path $RunDirectory 'automation') -Filter '*.png' -File -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
        $shotIndex += 1
        Copy-Item $_.FullName (Join-Path $stage ("{0}--screenshot-{1:D2}-{2}" -f $prefix, $shotIndex, $_.Name)) -Force
    }

    $bundle = Join-Path $bundlesRoot "$prefix--bundle.zip"
    Remove-Item -LiteralPath $bundle -Force -ErrorAction SilentlyContinue
    $bundleSources = Get-ChildItem -LiteralPath $RunDirectory -Force | Where-Object Name -ne 'upload'
    if ($bundleSources) { Compress-Archive -Path $bundleSources.FullName -DestinationPath $bundle -CompressionLevel Optimal -Force }
    if (Test-Path $bundle) { Copy-Item $bundle (Join-Path $stage (Split-Path $bundle -Leaf)) -Force }

    $assets = @(Get-ChildItem -LiteralPath $stage -File | Select-Object -ExpandProperty FullName)
    if ($assets.Count) {
        & gh release upload ([string]$config.release_tag) @assets --repo ([string]$config.github_repo) --clobber *> (Join-Path $RunDirectory 'github-upload.log')
        if ($LASTEXITCODE -ne 0) {
            Write-LabLog "GitHub upload failed for $prefix. Evidence remains in $RunDirectory." 'ERROR'
            return
        }
        Write-LabLog "Uploaded screenshots/logs/results for $prefix."
    }

    $names = @(& gh release view ([string]$config.release_tag) --repo ([string]$config.github_repo) --json assets --jq '.assets[].name' 2>$null)
    $groups = @($names | ForEach-Object {
        if ($_ -match '^(run-\d{8}-\d{6}-[0-9a-fA-F]{8})--') { $Matches[1] }
    } | Where-Object { $_ } | Sort-Object -Unique -Descending)
    $retain = [Math]::Max(1, [int]$config.retain_runs)
    foreach ($oldGroup in @($groups | Select-Object -Skip $retain)) {
        foreach ($assetName in @($names | Where-Object { $_ -like "$oldGroup--*" })) {
            & gh release delete-asset ([string]$config.release_tag) $assetName --repo ([string]$config.github_repo) -y *> $null
        }
    }
}

function Stop-ExactProcess([System.Diagnostics.Process]$Process) {
    if (-not $Process -or $Process.HasExited) { return }
    try { $null = $Process.CloseMainWindow() } catch {}
    try { if (-not $Process.WaitForExit(5000)) { $Process.Kill() } } catch {}
}

function Invoke-ValidationRun([string]$Commit) {
    $runStamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    $runDir = Join-Path $runsRoot ("$runStamp-$($Commit.Substring(0, 8))")
    $automationDir = Join-Path $runDir 'automation'
    New-Item -ItemType Directory -Force -Path $automationDir | Out-Null
    $steps = New-Object 'System.Collections.Generic.List[object]'
    $status = 'failed'
    $errorText = $null
    $appProcess = $null
    $startedAt = [DateTime]::UtcNow

    Write-LabLog "Starting validation for dev commit $Commit."
    try {
        $trackedChanges = @(Git status --porcelain --untracked-files=no)
        if ($trackedChanges.Count -gt 0 -and ($trackedChanges -join '').Trim()) {
            throw "Dedicated dev checkout has tracked local changes; refusing to overwrite them: $($trackedChanges -join '; ')"
        }

        Git checkout $branch | Out-Null
        Git reset --hard "origin/$branch" | Out-Null
        $actual = (Git rev-parse HEAD | Select-Object -First 1).Trim()
        if ($actual -ne $Commit) { throw "Expected $Commit after sync, got $actual." }

        $desktop = Join-Path $repoRoot 'apps\desktop'
        $api = Join-Path $repoRoot 'apps\api'

        if ([bool]$config.tests.frontend) {
            if (-not (Invoke-Step 'npm-ci' $desktop 'npm.cmd' @('ci') $runDir $steps)) { throw 'npm ci failed' }
            if (-not (Invoke-Step 'frontend-tests' $desktop 'npm.cmd' @('test') $runDir $steps)) { throw 'frontend tests failed' }
            if (-not (Invoke-Step 'frontend-build' $desktop 'npm.cmd' @('run', 'build') $runDir $steps)) { throw 'frontend build failed' }
        }

        if ([bool]$config.tests.api) {
            $apiPython = Join-Path $api '.venv\Scripts\python.exe'
            if (-not (Test-Path -LiteralPath $apiPython -PathType Leaf)) {
                if (-not (Invoke-Step 'api-venv' $api 'py.exe' @('-3', '-m', 'venv', '.venv') $runDir $steps)) { throw 'API venv creation failed' }
            }
            if (-not (Invoke-Step 'api-deps' $api $apiPython @('-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements-dev.txt') $runDir $steps)) { throw 'API dependency install failed' }
            if (-not (Invoke-Step 'api-tests' $api $apiPython @('-m', 'pytest', '-q', 'tests') $runDir $steps)) { throw 'API tests failed' }
        }

        if ([bool]$config.tests.rust) {
            if (-not (Invoke-Step 'prepare-icons' $desktop 'npm.cmd' @('run', 'prepare-icons') $runDir $steps)) { throw 'icon preparation failed' }
            if (-not (Invoke-Step 'rust-tests' $desktop 'cargo.exe' @('test', '--manifest-path', 'src-tauri/Cargo.toml') $runDir $steps)) { throw 'Rust/Tauri tests failed' }
        }

        if ([bool]$config.tests.release_build) {
            if (-not (Invoke-Step 'release-build' $repoRoot 'powershell.exe' @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repoRoot 'build-and-run.ps1'), '-NoRun') $runDir $steps)) { throw 'release build failed' }
        }

        $casePath = Join-Path $repoRoot ([string]$config.automation_case)
        if (-not (Test-Path -LiteralPath $casePath -PathType Leaf)) { throw "Automation case does not exist: $casePath" }
        $exe = Join-Path $repoRoot 'GameAccess-latest.exe'
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Built GameAccess executable is missing: $exe" }

        $stdout = Join-Path $runDir 'app.stdout.log'
        $stderr = Join-Path $runDir 'app.stderr.log'
        $argumentLine = "--automation-script `"$casePath`" --automation-output `"$automationDir`""
        $appProcess = Start-Process -FilePath $exe -WorkingDirectory $repoRoot -ArgumentList $argumentLine -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        Set-Content -LiteralPath $activeAppPidFile -Value $appProcess.Id -Encoding ASCII
        Write-LabLog "Launched GameAccess automation case '$($config.automation_case)' as PID $($appProcess.Id)."

        $resultPath = Join-Path $automationDir 'result.json'
        $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(30, [int]$config.automation_timeout_seconds))
        while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
            if ($appProcess.HasExited) { break }
            Start-Sleep -Milliseconds 500
        }
        if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
            throw "Automation result.json was not produced before timeout/process exit."
        }
        $automationResult = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
        if ([string]$automationResult.status -ne 'ok') {
            throw "GameAccess automation reported '$($automationResult.status)': $($automationResult.error)"
        }
        $status = 'ok'
    } catch {
        $errorText = $_.Exception.Message
        Write-LabLog "Validation failed for $Commit: $errorText" 'ERROR'
    } finally {
        Stop-ExactProcess $appProcess
        Remove-Item -LiteralPath $activeAppPidFile -Force -ErrorAction SilentlyContinue
        Sanitize-TextFile $gameAccessLog (Join-Path $runDir 'gameaccess.sanitized.log')
        $summary = [ordered]@{
            schema_version = 1
            commit = $Commit
            branch = $branch
            status = $status
            error = $errorText
            started_at = $startedAt.ToString('o')
            finished_at = [DateTime]::UtcNow.ToString('o')
            automation_case = [string]$config.automation_case
            steps = @($steps)
        }
        $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runDir 'summary.json') -Encoding UTF8
        Publish-Run $runDir $Commit $runStamp
    }

    return $status
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) { throw "Not a Git checkout: $repoRoot" }
    Write-LabLog "Watcher started for $repoRoot -> origin/$branch (poll ${pollSeconds}s)."
    $state = Load-State
    $first = $true

    while (-not (Test-Path -LiteralPath $stopFile)) {
        try {
            Git fetch --prune origin $branch | Out-Null
            $remote = (Git rev-parse "origin/$branch" | Select-Object -First 1).Trim()
            $shouldRun = $remote -ne [string]$state.last_processed_sha
            if ($first -and -not [bool]$config.run_on_start -and -not [string]$state.last_processed_sha) {
                $state.last_processed_sha = $remote
                Save-State $state
                $shouldRun = $false
            }
            $first = $false

            if ($shouldRun) {
                $result = Invoke-ValidationRun $remote
                $state.last_processed_sha = $remote
                if ($result -eq 'ok') { $state.last_passed_sha = $remote }
                $state.last_run = [DateTime]::UtcNow.ToString('o')
                Save-State $state
            }
        } catch {
            Write-LabLog "Polling cycle failed: $($_.Exception.Message)" 'ERROR'
        }
        if (-not (Test-Path -LiteralPath $stopFile)) { Start-Sleep -Seconds $pollSeconds }
    }
    Write-LabLog 'Watcher stop flag received. Exiting.'
} finally {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
