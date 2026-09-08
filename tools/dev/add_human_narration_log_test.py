from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


checks = {
    "apps/desktop/src/narrationLog.ts": [
        "append_narration_log",
        "append_narration_log_batch",
        "Starting GameAccess desktop front end",
    ],
    "apps/desktop/src-tauri/src/main.rs": [
        "gameaccess.log",
        "fn narration_log_path()",
        "append_narration_log_batch",
    ],
    "apps/desktop/src/main.tsx": [
        "startNarrationSession",
        "Manual catalog refresh requested",
    ],
    "apps/desktop/src/api.ts": [
        "Scanning local Steam data for remembered personal accounts",
        "Server license state: copies_total=",
        "Evaluating which account/license route is allowed",
    ],
    "apps/desktop/src/catalog.ts": [
        "accessible_app_ids by itself never grants play",
        "Ownership candidates currently supplied by the local scanner in app_ids",
    ],
    "apps/desktop/src/native.ts": [
        "Download requested for Steam AppID",
        "Resolving the Steam account and launch route",
        "Password and authentication material are intentionally omitted from the log",
    ],
    "build-and-run.ps1": [
        "C:\\SebaSU_Tools",
        "Starting local GameAccess backend server",
        "Install-SebaSUTailHelper",
    ],
    "tools/windows/tail.ps1": [
        "Get-Content -LiteralPath $resolved -Tail $Lines -Wait",
        "Press Ctrl+C to stop",
    ],
    "tools/windows/tail.cmd": [
        "tail.ps1",
    ],
}

for path, needles in checks.items():
    content = text(path)
    for needle in needles:
        assert needle in content, f"{path} is missing expected narration/logging marker: {needle}"

native = text("apps/desktop/src/native.ts")
assert "${credentials.password}" not in native
assert "credentials.password}`" not in native

print("Human narration logging patch checks passed.")
