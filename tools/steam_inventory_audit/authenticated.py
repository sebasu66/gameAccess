from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LAUNCHER_DIR = PROJECT_ROOT / "apps" / "launcher"
SCANNER_PROJECT = PROJECT_ROOT / "tools" / "steamkit-inventory-scanner" / "SteamKitInventoryScanner.csproj"
SCANNER_SOURCE = PROJECT_ROOT / "tools" / "steamkit-inventory-scanner" / "Program.cs"
SCANNER_DLL = PROJECT_ROOT / "tools" / "steamkit-inventory-scanner" / "bin" / "Debug" / "net10.0" / "SteamKitInventoryScanner.dll"

sys.path.insert(0, str(LAUNCHER_DIR))
from provider_roster import load_provider_credentials  # noqa: E402


def ensure_scanner_built() -> None:
    source_mtime = max(
        SCANNER_PROJECT.stat().st_mtime if SCANNER_PROJECT.is_file() else 0,
        SCANNER_SOURCE.stat().st_mtime if SCANNER_SOURCE.is_file() else 0,
    )
    if SCANNER_DLL.is_file() and SCANNER_DLL.stat().st_mtime >= source_mtime:
        return
    completed = subprocess.run(
        ["dotnet", "build", str(SCANNER_PROJECT)],
        cwd=PROJECT_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=180,
    )
    if completed.returncode != 0 or not SCANNER_DLL.is_file():
        detail = (completed.stderr or completed.stdout or "dotnet build failed").strip()
        raise RuntimeError(detail[-4000:])


def find_credential(account: str):
    target = account.strip().casefold()
    for credential in load_provider_credentials():
        if target in {
            credential.provider_id.casefold(),
            credential.label.casefold(),
            credential.login.casefold(),
        }:
            return credential
    raise RuntimeError(f"Provider account not found: {account}")


def _steam_process_running() -> bool:
    if os.name != "nt":
        return False
    completed = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=10,
    )
    return "steam.exe" in completed.stdout.casefold()


def close_steam() -> None:
    if os.name != "nt" or not _steam_process_running():
        return
    steam_candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Steam" / "steam.exe",
        Path(os.environ.get("PROGRAMFILES", "")) / "Steam" / "steam.exe",
        Path(r"C:\Steam\steam.exe"),
    ]
    steam_exe = next((path for path in steam_candidates if path.is_file()), None)
    if steam_exe is not None:
        try:
            subprocess.Popen(
                [str(steam_exe), "steam://exit"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            pass
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if not _steam_process_running():
            return
        time.sleep(0.4)
    subprocess.run(
        ["taskkill", "/F", "/IM", "steam.exe", "/T"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=15,
        check=False,
    )
    time.sleep(1)


def login_id(provider_id: str) -> int:
    try:
        slot = int(provider_id.rsplit("-", 1)[-1])
    except (TypeError, ValueError):
        slot = 1
    return 0x4741F000 + max(1, min(slot, 0xFFF))


def scan(
    account: str,
    *,
    contexts: str | None = None,
    stop_steam: bool = True,
    include_items: bool = False,
) -> dict:
    credential = find_credential(account)
    ensure_scanner_built()
    if stop_steam:
        close_steam()

    env = os.environ.copy()
    env["GA_STEAM_USER"] = credential.login
    env["GA_STEAM_PASS"] = credential.password
    env["GA_STEAM_LOGIN_ID"] = str(login_id(credential.provider_id))
    env["GA_STEAM_TIMEOUT_SECONDS"] = "90"
    env["GA_INVENTORY_INCLUDE_ITEMS"] = "1" if include_items else "0"
    if contexts:
        env["GA_INVENTORY_CONTEXTS"] = contexts

    completed = subprocess.run(
        ["dotnet", str(SCANNER_DLL)],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
    )
    lines = [line for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError((completed.stderr or "SteamKit inventory scanner returned no JSON").strip()[-2000:])
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("SteamKit inventory scanner returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("SteamKit inventory scanner returned a non-object payload")
    payload["provider_id"] = credential.provider_id
    payload["label"] = credential.label
    payload["exit_code"] = completed.returncode
    return payload


def inventory_items(payload: dict) -> list[dict]:
    result: list[dict] = []
    for context in payload.get("contexts") or []:
        if not isinstance(context, dict):
            continue
        for item in context.get("items") or []:
            if isinstance(item, dict):
                result.append(item)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Authenticated read-only Steam inventory probe for one GameAccess provider account")
    parser.add_argument("account", help="provider ID, label, or Steam login")
    parser.add_argument("--contexts", help="Comma-separated APPID:CONTEXTID[:LABEL] entries")
    parser.add_argument("--include-items", action="store_true", help="Include every paginated inventory asset in the JSON output")
    parser.add_argument("--keep-steam-open", action="store_true", help="Do not close steam.exe before authentication")
    args = parser.parse_args()

    payload = scan(
        args.account,
        contexts=args.contexts,
        stop_steam=not args.keep_steam_open,
        include_items=args.include_items,
    )
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload.get("status") == "ok" else int(payload.get("exit_code") or 1)


if __name__ == "__main__":
    raise SystemExit(main())
