from __future__ import annotations

from pathlib import Path

WATCHER = Path(__file__).resolve().parent / "watch.ps1"


def main() -> int:
    text = WATCHER.read_text(encoding="utf-8")

    # Windows PowerShell parses "$Commit:" as a drive-qualified variable.
    text = text.replace(
        'Write-LabLog "Validation failed for $Commit: $errorText" \'ERROR\'',
        'Write-LabLog "Validation failed for ${Commit}: $errorText" \'ERROR\'',
    )

    # Keep validation Git commands verbose, but polling Git commands silent.
    if "function GitQuiet(" not in text:
        marker = "function Load-State {"
        insert = '''function GitQuiet([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {
    $output = & git -C $repoRoot @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
    return @($output)
}

'''
        pos = text.find(marker)
        if pos < 0:
            raise RuntimeError("Could not find Load-State marker for GitQuiet insertion")
        text = text[:pos] + insert + text[pos:]

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
                $result = Invoke-ValidationRun $remote
                $state.last_processed_sha = $remote
                if ($result -eq 'ok') { $state.last_passed_sha = $remote }
                $state.last_run = [DateTime]::UtcNow.ToString('o')
                Save-State $state
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
    print("Patched Dev Lab watcher: silent polling, hard interval, throttled repeated errors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
