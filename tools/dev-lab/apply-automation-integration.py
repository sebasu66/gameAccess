from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAIN = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "main.rs"
WATCHER = ROOT / "tools" / "dev-lab" / "watch.ps1"


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


def patch_watcher() -> None:
    text = WATCHER.read_text(encoding="utf-8")
    text = text.replace("ConvertFrom-Json -AsHashtable", "ConvertFrom-Json")
    text = replace_once(
        text,
        "$pidFile = Join-Path $stateRoot 'watcher.pid'\n",
        "$pidFile = Join-Path $stateRoot 'watcher.pid'\n$activeAppPidFile = Join-Path $stateRoot 'active-app.pid'\n",
        "active app pid state",
    )
    text = replace_once(
        text,
        "        $appProcess = Start-Process -FilePath $exe -WorkingDirectory $repoRoot -ArgumentList $argumentLine -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr\n        Write-LabLog \"Launched GameAccess automation case '$($config.automation_case)' as PID $($appProcess.Id).\"\n",
        "        $appProcess = Start-Process -FilePath $exe -WorkingDirectory $repoRoot -ArgumentList $argumentLine -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr\n        Set-Content -LiteralPath $activeAppPidFile -Value $appProcess.Id -Encoding ASCII\n        Write-LabLog \"Launched GameAccess automation case '$($config.automation_case)' as PID $($appProcess.Id).\"\n",
        "active app pid write",
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
    patch_watcher()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
