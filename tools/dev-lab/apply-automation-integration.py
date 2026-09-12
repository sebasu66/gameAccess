from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "main.rs"
WATCHER = ROOT / "tools" / "dev-lab" / "watch.ps1"
START = ROOT / "tools" / "dev-lab" / "start.ps1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def patch_main() -> None:
    text = MAIN.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "mod download_lifecycle;\n",
        "mod automation;\nmod download_lifecycle;\n",
        "automation module declaration",
    )
    text = replace_once(
        text,
        "fn main() {\n    let visual_debug_dir = visual_debug_session_dir();\n    tauri::Builder::default()\n        .manage(VisualDebugState {\n",
        "fn main() {\n    let visual_debug_dir = visual_debug_session_dir();\n    let automation_state = automation::AutomationState::from_process();\n    tauri::Builder::default()\n        .manage(automation_state)\n        .manage(VisualDebugState {\n",
        "automation state registration",
    )
    text = replace_once(
        text,
        "        .invoke_handler(tauri::generate_handler![\n            narration_log_path,\n",
        "        .invoke_handler(tauri::generate_handler![\n            automation::automation_config,\n            automation::capture_automation_screenshot,\n            automation::finish_automation,\n            narration_log_path,\n",
        "automation command registration",
    )
    MAIN.write_text(text, encoding="utf-8")
    print(f"Patched {MAIN}")


def patch_start() -> None:
    text = START.read_text(encoding="utf-8")
    old = """Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
$argumentLine = \"-NoLogo -NoProfile -ExecutionPolicy Bypass -File `\"$watcher`\" -ConfigPath `\"$ConfigPath`\"\"
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentLine -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII
Write-Host \"Game Access Dev Lab started (PID $($process.Id)).\"
Write-Host \"Watching origin/dev. Log: $stateRoot\\watcher.log\"
"""
    new = """Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '============================================================'
Write-Host ' GAME ACCESS DEV LAB - LIVE WATCHER'
Write-Host '============================================================'
Write-Host \"Repository : C:\\DEV\\Game Access Dev\"
Write-Host \"Config     : $ConfigPath\"
Write-Host \"Log        : $stateRoot\\watcher.log\"
Write-Host 'Mode       : foreground / live output'
Write-Host 'Stop       : Ctrl+C, close this terminal, or run STOP_GAMEACCESS_DEV_LAB.cmd'
Write-Host '============================================================'
Write-Host ''

try {
    & $watcher -ConfigPath $ConfigPath
} catch {
    Write-Host ''
    Write-Host \"DEV LAB TERMINATED WITH ERROR: $($_.Exception.Message)\" -ForegroundColor Red
    throw
} finally {
    Write-Host ''
    Write-Host 'Game Access Dev Lab watcher has stopped.'
}
"""
    if old in text:
        text = text.replace(old, new, 1)
    START.write_text(text, encoding="utf-8")
    print(f"Patched {START}")


def patch_watcher() -> None:
    text = WATCHER.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "[CmdletBinding()]\nparam(\n    [string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json')\n)\n\n$ErrorActionPreference = 'Stop'\n$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json\n",
        "[CmdletBinding()]\nparam(\n    [string]$ConfigPath = ''\n)\n\n$ErrorActionPreference = 'Stop'\n$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path\nif (-not $ConfigPath) { $ConfigPath = Join-Path $scriptRoot 'config.json' }\n$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json\n",
        "PowerShell config path resolution",
    )
    text = text.replace("ConvertFrom-Json -AsHashtable", "ConvertFrom-Json")
    text = replace_once(
        text,
        "$pidFile = Join-Path $stateRoot 'watcher.pid'\n",
        "$pidFile = Join-Path $stateRoot 'watcher.pid'\n$activeAppPidFile = Join-Path $stateRoot 'active-app.pid'\n",
        "active app pid state",
    )
    text = replace_once(
        text,
        "function Write-LabLog([string]$Message, [string]$Level = 'INFO') {\n    $line = '{0} [{1}] {2}' -f ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')), $Level, $Message\n    Add-Content -LiteralPath $watcherLog -Value $line -Encoding UTF8\n}\n",
        "function Write-LabLog([string]$Message, [string]$Level = 'INFO') {\n    $line = '{0} [{1}] {2}' -f ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')), $Level, $Message\n    Add-Content -LiteralPath $watcherLog -Value $line -Encoding UTF8\n    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red }\n    elseif ($Level -eq 'WARN') { Write-Host $line -ForegroundColor Yellow }\n    else { Write-Host $line }\n}\n",
        "live watcher log output",
    )
    text = replace_once(
        text,
        "function Git([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {\n    $output = & git -C $repoRoot @Arguments 2>&1\n    if ($LASTEXITCODE -ne 0) { throw \"git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)\" }\n    return @($output)\n}\n",
        "function Git([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments) {\n    Write-Host (\"> git -C `\"{0}`\" {1}\" -f $repoRoot, ($Arguments -join ' ')) -ForegroundColor DarkGray\n    $output = & git -C $repoRoot @Arguments 2>&1\n    if ($output) { @($output) | ForEach-Object { Write-Host $_ } }\n    if ($LASTEXITCODE -ne 0) { throw \"git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)\" }\n    return @($output)\n}\n",
        "live git output",
    )
    text = replace_once(
        text,
        "function Save-State($State) {\n    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $stateFile -Encoding UTF8\n}\n",
        "function Save-State($State) {\n    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $stateFile -Encoding UTF8\n}\n\nfunction Show-NewTextLines([string]$Path, [ref]$LineCount, [string]$Prefix = '') {\n    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }\n    $lines = @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)\n    $seen = [int]$LineCount.Value\n    for ($i = $seen; $i -lt $lines.Count; $i++) {\n        Write-Host (\"{0}{1}\" -f $Prefix, $lines[$i])\n    }\n    $LineCount.Value = $lines.Count\n}\n",
        "live file tail helper",
    )
    text = replace_once(
        text,
        "            $global:LASTEXITCODE = 0\n            $output = & $File @Arguments 2>&1\n            $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }\n            @($output) | Out-File -LiteralPath $logPath -Encoding utf8\n",
        "            $global:LASTEXITCODE = 0\n            Write-LabLog (\"COMMAND [{0}] {1} {2}\" -f $Name, $File, ($Arguments -join ' '))\n            & $File @Arguments 2>&1 | Tee-Object -FilePath $logPath | ForEach-Object { Write-Host $_ }\n            $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }\n",
        "live command output",
    )
    text = replace_once(
        text,
        "    } catch {\n        $_ | Out-String | Out-File -LiteralPath $logPath -Encoding utf8\n        $exitCode = 1\n    }\n",
        "    } catch {\n        $errorOutput = $_ | Out-String\n        $errorOutput | Out-File -LiteralPath $logPath -Encoding utf8\n        Write-Host $errorOutput -ForegroundColor Red\n        $exitCode = 1\n    }\n",
        "live command error output",
    )
    text = replace_once(
        text,
        "        $appProcess = Start-Process -FilePath $exe -WorkingDirectory $repoRoot -ArgumentList $argumentLine -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr\n        Write-LabLog \"Launched GameAccess automation case '$($config.automation_case)' as PID $($appProcess.Id).\"\n",
        "        $appProcess = Start-Process -FilePath $exe -WorkingDirectory $repoRoot -ArgumentList $argumentLine -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr\n        Set-Content -LiteralPath $activeAppPidFile -Value $appProcess.Id -Encoding ASCII\n        Write-LabLog \"Launched GameAccess automation case '$($config.automation_case)' as PID $($appProcess.Id).\"\n",
        "active app pid write",
    )
    text = replace_once(
        text,
        "        $resultPath = Join-Path $automationDir 'result.json'\n        $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(30, [int]$config.automation_timeout_seconds))\n        while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {\n            if ($appProcess.HasExited) { break }\n            Start-Sleep -Milliseconds 500\n        }\n",
        "        $resultPath = Join-Path $automationDir 'result.json'\n        $gameAccessLogLines = if (Test-Path -LiteralPath $gameAccessLog -PathType Leaf) { @(Get-Content -LiteralPath $gameAccessLog -ErrorAction SilentlyContinue).Count } else { 0 }\n        $stdoutLines = 0\n        $stderrLines = 0\n        $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(30, [int]$config.automation_timeout_seconds))\n        while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {\n            Show-NewTextLines $gameAccessLog ([ref]$gameAccessLogLines) '[GAMEACCESS] '\n            Show-NewTextLines $stdout ([ref]$stdoutLines) '[APP-OUT] '\n            Show-NewTextLines $stderr ([ref]$stderrLines) '[APP-ERR] '\n            if ($appProcess.HasExited) { break }\n            Start-Sleep -Milliseconds 500\n        }\n        Show-NewTextLines $gameAccessLog ([ref]$gameAccessLogLines) '[GAMEACCESS] '\n        Show-NewTextLines $stdout ([ref]$stdoutLines) '[APP-OUT] '\n        Show-NewTextLines $stderr ([ref]$stderrLines) '[APP-ERR] '\n",
        "live GameAccess output",
    )
    text = replace_once(
        text,
        "        Stop-ExactProcess $appProcess\n        Sanitize-TextFile $gameAccessLog (Join-Path $runDir 'gameaccess.sanitized.log')\n",
        "        Stop-ExactProcess $appProcess\n        Remove-Item -LiteralPath $activeAppPidFile -Force -ErrorAction SilentlyContinue\n        Sanitize-TextFile $gameAccessLog (Join-Path $runDir 'gameaccess.sanitized.log')\n",
        "active app pid cleanup",
    )
    WATCHER.write_text(text, encoding="utf-8")
    print(f"Patched {WATCHER}")


def main() -> int:
    patch_main()
    patch_start()
    patch_watcher()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
