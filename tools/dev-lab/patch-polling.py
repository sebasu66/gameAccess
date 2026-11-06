from __future__ import annotations

from pathlib import Path

WATCHER = Path(__file__).resolve().parent / "watch.ps1"


def replace_if_present(text: str, old: str, new: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise RuntimeError("Expected Dev Lab watcher block was not found")


def main() -> int:
    text = WATCHER.read_text(encoding="utf-8")

    # PowerShell command lookup is case-insensitive. Because this script also
    # defines a function named Git, invoking "git" from inside that function
    # recursively calls the function instead of git.exe. Force the executable.
    text = text.replace(
        "$output = & git -C $repoRoot @Arguments 2>&1",
        "$output = & git.exe -C $repoRoot @Arguments 2>&1",
    )

    # Windows PowerShell 5.1 can promote ordinary native stderr to a terminating
    # ErrorRecord when $ErrorActionPreference is Stop. Native programs routinely
    # write harmless diagnostics/progress to stderr, so trust their exit code.
    verbose_git_old = '''function Git([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
    Write-Host ("> git -C `"{0}`" {1}" -f $repoRoot, ($Arguments -join ' ')) -ForegroundColor DarkGray
    $output = & git.exe -C $repoRoot @Arguments 2>&1
    if ($output) { @($output) | ForEach-Object { Write-Host $_ } }
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
    return @($output)
}
'''
    verbose_git_new = '''function Git([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
    Write-Host ("> git -C `"{0}`" {1}" -f $repoRoot, ($Arguments -join ' ')) -ForegroundColor DarkGray
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & git.exe -C $repoRoot @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($output) { @($output) | ForEach-Object { Write-Host $_ } }
    if ($exitCode -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
    return @($output)
}
'''
    if verbose_git_old in text:
        text = text.replace(verbose_git_old, verbose_git_new, 1)
    elif verbose_git_new not in text:
        raise RuntimeError("Could not patch verbose Git function for native stderr handling")

    text = text.replace(
        'Write-LabLog "Validation failed for $Commit: $errorText" \'ERROR\'',
        'Write-LabLog "Validation failed for ${Commit}: $errorText" \'ERROR\'',
    )

    quiet_git_old = '''function GitQuiet([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
    $output = & git.exe -C $repoRoot @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
    return @($output)
}
'''
    quiet_git_new = '''function GitQuiet([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & git.exe -C $repoRoot @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
    return @($output)
}
'''

    if "function GitQuiet(" not in text:
        marker = "function Load-State {"
        pos = text.find(marker)
        if pos < 0:
            raise RuntimeError("Could not find Load-State marker for GitQuiet insertion")
        text = text[:pos] + quiet_git_new + "\n" + text[pos:]
    elif quiet_git_old in text:
        text = text.replace(quiet_git_old, quiet_git_new, 1)
    elif quiet_git_new not in text:
        raise RuntimeError("Could not patch GitQuiet function for native stderr handling")

    # Apply the same native-stderr rule to every validation command (npm, cargo,
    # pytest, PowerShell build scripts, etc.). Vitest legitimately writes some
    # test diagnostics to stderr even when the command succeeds.
    invoke_old = '''            $global:LASTEXITCODE = 0
            Write-LabLog ("COMMAND [{0}] {1} {2}" -f $Name, $File, ($Arguments -join ' '))
            & $File @Arguments 2>&1 | Tee-Object -FilePath $logPath | ForEach-Object { Write-Host $_ }
            $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
'''
    invoke_new = '''            $global:LASTEXITCODE = 0
            Write-LabLog ("COMMAND [{0}] {1} {2}" -f $Name, $File, ($Arguments -join ' '))
            $previousErrorActionPreference = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                & $File @Arguments 2>&1 | Tee-Object -FilePath $logPath | ForEach-Object { Write-Host $_ }
                $nativeExitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }
            $exitCode = if ($null -eq $nativeExitCode) { 0 } else { [int]$nativeExitCode }
'''
    text = replace_if_present(text, invoke_old, invoke_new)

    # A failed validation must still produce evidence and return a status; evidence
    # serialization/upload errors must not escape into the polling loop. Enumerate
    # the generic List explicitly because Windows PowerShell 5 can throw a binder
    # "argument types do not match" error for @($genericList) in this context.
    finalize_old = '''        $summary = [ordered]@{
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
'''
    finalize_new = '''        try {
            $stepArray = @($steps | ForEach-Object { $_ })
            $summary = [ordered]@{
                schema_version = 1
                commit = $Commit
                branch = $branch
                status = $status
                error = $errorText
                started_at = $startedAt.ToString('o')
                finished_at = [DateTime]::UtcNow.ToString('o')
                automation_case = [string]$config.automation_case
                steps = $stepArray
            }
            $summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runDir 'summary.json') -Encoding UTF8
            try {
                Publish-Run $runDir $Commit $runStamp
            } catch {
                Write-LabLog "Evidence publication failed for ${Commit}: $($_.Exception.Message)" 'ERROR'
            }
        } catch {
            Write-LabLog "Evidence finalization failed for ${Commit}: $($_.Exception.Message)" 'ERROR'
        }
'''
    text = replace_if_present(text, finalize_old, finalize_new)

    if "$lastPollingErrorAt" not in text:
        marker = "    $first = $true\n"
        replacement = marker + "    $lastPollingError = ''\n    $lastPollingErrorAt = [DateTime]::MinValue\n"
        if marker not in text:
            raise RuntimeError("Could not find watcher state initialization")
        text = text.replace(marker, replacement, 1)

    loop_marker = "    while (-not (Test-Path -LiteralPath $stopFile)) {"
    loop_start = text.find(loop_marker, text.find("$lastPollingErrorAt"))
    loop_end_marker = "    Write-LabLog 'Watcher stop flag received. Exiting.'"
    loop_end = text.find(loop_end_marker, loop_start)
    if loop_start < 0 or loop_end < 0:
        raise RuntimeError("Could not locate watcher polling loop")

    replacement = '''    while (-not (Test-Path -LiteralPath $stopFile)) {
        $cycleStartedAt = [DateTime]::UtcNow
        try {
            # Polling is intentionally silent. Console output is reserved for
            # detected commits, validation commands and real errors.
            GitQuiet fetch --prune origin $branch | Out-Null
            $remote = (GitQuiet rev-parse "origin/$branch" | Select-Object -First 1).Trim()
            $lastPollingError = ''

            $shouldRun = $remote -ne [string]$state.last_processed_sha
            if ($first -and -not [bool]$config.run_on_start -and -not [string]$state.last_processed_sha) {
                $state.last_processed_sha = $remote
                Save-State $state
                $shouldRun = $false
            }
            $first = $false

            if ($shouldRun) {
                Write-LabLog "Detected new origin/$branch commit $remote. Starting validation."

                # Claim this SHA before running it. A broken commit is reported once;
                # it is not retried forever on every polling cycle.
                $state.last_processed_sha = $remote
                $state.last_run = [DateTime]::UtcNow.ToString('o')
                Save-State $state

                $result = Invoke-ValidationRun $remote
                if ($result -eq 'ok') {
                    $state.last_passed_sha = $remote
                    Save-State $state
                }
            }
        } catch {
            $currentPollingError = $_.Exception.Message
            $now = [DateTime]::UtcNow
            if ($currentPollingError -ne $lastPollingError -or ($now - $lastPollingErrorAt).TotalMinutes -ge 5) {
                Write-LabLog "Polling cycle failed: $currentPollingError" 'ERROR'
                $lastPollingError = $currentPollingError
                $lastPollingErrorAt = $now
            }
        }

        # Hard rate limit: even if polling or validation fails instantly, the
        # next poll cannot run immediately. Long validation runs also get a
        # full poll interval before another fetch.
        if (-not (Test-Path -LiteralPath $stopFile)) {
            $elapsedMs = ([DateTime]::UtcNow - $cycleStartedAt).TotalMilliseconds
            $intervalMs = [double]$pollSeconds * 1000.0
            if ($elapsedMs -ge $intervalMs) {
                $waitMs = $intervalMs
            } else {
                $waitMs = $intervalMs - $elapsedMs
            }
            $remaining = [int][Math]::Ceiling([Math]::Max(1000.0, $waitMs))
            while ($remaining -gt 0 -and -not (Test-Path -LiteralPath $stopFile)) {
                $chunk = [Math]::Min(250, $remaining)
                Start-Sleep -Milliseconds $chunk
                $remaining -= $chunk
            }
        }
    }
'''

    text = text[:loop_start] + replacement + text[loop_end:]
    WATCHER.write_text(text, encoding="utf-8")
    print(
        "Patched Dev Lab watcher: safe native stderr, one-shot failed commits, "
        "safe evidence finalization, silent polling and hard interval."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
