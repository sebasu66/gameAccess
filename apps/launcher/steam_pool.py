"""Discover a local Steam account/game pool without reading credentials.

The scanner only uses:
- Steam's visible remembered-account chooser (via steam_switch.py);
- HKCU\\Software\\Valve\\Steam\\ActiveProcess\\ActiveUser to identify the
  currently active local Steam user id;
- that user's localconfig.vdf *apps* section, which is library/play metadata.

It intentionally does not read passwords, Steam Guard secrets, cookies,
login keys, tokens or auth blobs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from steam_switch import (
    RememberedSteamAccount,
    find_steam_exe,
    list_remembered_accounts,
    switch_to_remembered_account,
)

if os.name == "nt":
    import winreg
else:  # pragma: no cover - Windows-only MVP
    winreg = None


@dataclass
class SteamPoolAccount:
    display_name: str
    account_name: str
    active_user_id32: int | None
    app_ids: list[int]
    ok: bool
    message: str


def active_user_id32() -> int | None:
    if winreg is None:
        return None
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam\ActiveProcess") as key:
            value, _ = winreg.QueryValueEx(key, "ActiveUser")
        number = int(value)
        return number if number > 0 else None
    except (OSError, TypeError, ValueError):
        return None


def steam_root() -> Path | None:
    exe = find_steam_exe()
    return exe.parent if exe else None


def _tokenize_vdf(text: str) -> list[str]:
    # Quoted strings and braces are enough for the localconfig structure we read.
    token_re = re.compile(r'"((?:\\.|[^"\\])*)"|([{}])')
    tokens: list[str] = []
    for match in token_re.finditer(text):
        if match.group(2):
            tokens.append(match.group(2))
        else:
            tokens.append(bytes(match.group(1), "utf-8").decode("unicode_escape"))
    return tokens


def _parse_vdf_object(tokens: list[str], index: int = 0) -> tuple[dict[str, Any], int]:
    result: dict[str, Any] = {}
    while index < len(tokens):
        token = tokens[index]
        if token == "}":
            return result, index + 1
        if token == "{":
            index += 1
            continue
        key = token
        index += 1
        if index >= len(tokens):
            result[key] = ""
            break
        value = tokens[index]
        if value == "{":
            child, index = _parse_vdf_object(tokens, index + 1)
            result[key] = child
        else:
            result[key] = value
            index += 1
    return result, index


def _ci_get(mapping: Any, key: str) -> Any:
    if not isinstance(mapping, dict):
        return None
    folded = key.casefold()
    for candidate, value in mapping.items():
        if str(candidate).casefold() == folded:
            return value
    return None


def local_library_apps(user_id32: int) -> dict[int, dict[str, Any]]:
    root = steam_root()
    if not root:
        return {}
    path = root / "userdata" / str(user_id32) / "config" / "localconfig.vdf"
    if not path.is_file():
        return {}
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        parsed, _ = _parse_vdf_object(_tokenize_vdf(text))
        software = _ci_get(parsed, "Software")
        valve = _ci_get(software, "Valve")
        steam = _ci_get(valve, "Steam")
        apps = _ci_get(steam, "apps")
        if not isinstance(apps, dict):
            return {}
        result: dict[int, dict[str, Any]] = {}
        for key, value in apps.items():
            if str(key).isdigit():
                result[int(key)] = value if isinstance(value, dict) else {}
        return result
    except Exception:
        return {}


def _wait_for_active_user(timeout: float = 12.0) -> int | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = active_user_id32()
        if value:
            return value
        time.sleep(0.35)
    return None


def scan_account(account: RememberedSteamAccount) -> SteamPoolAccount:
    switched = switch_to_remembered_account(account.display_name or account.account_name)
    if not switched.ok:
        return SteamPoolAccount(
            display_name=account.display_name,
            account_name=account.account_name,
            active_user_id32=None,
            app_ids=[],
            ok=False,
            message=switched.message,
        )
    user_id = _wait_for_active_user()
    if not user_id:
        return SteamPoolAccount(
            display_name=account.display_name,
            account_name=account.account_name,
            active_user_id32=None,
            app_ids=[],
            ok=False,
            message="Steam switched accounts but ActiveUser was not available",
        )
    # Give Steam a moment to flush account-local library metadata after login.
    time.sleep(2.0)
    apps = local_library_apps(user_id)
    return SteamPoolAccount(
        display_name=account.display_name,
        account_name=account.account_name,
        active_user_id32=user_id,
        app_ids=sorted(apps),
        ok=True,
        message=f"Discovered {len(apps)} local library app entries",
    )


def scan_pool(restore_original: bool = True) -> dict[str, Any]:
    original_user = active_user_id32()
    discovery, accounts = list_remembered_accounts(open_chooser=True)
    if not discovery.ok:
        return {"ok": False, "message": discovery.message, "accounts": [], "licenses": {}}

    scanned: list[SteamPoolAccount] = []
    by_user: dict[int, RememberedSteamAccount] = {}
    for account in accounts:
        item = scan_account(account)
        scanned.append(item)
        if item.active_user_id32:
            by_user[item.active_user_id32] = account

    licenses: dict[int, list[str]] = {}
    for item in scanned:
        if not item.ok:
            continue
        label = item.display_name or item.account_name
        for app_id in item.app_ids:
            licenses.setdefault(app_id, []).append(label)

    restored = False
    if restore_original and original_user and original_user in by_user:
        original_account = by_user[original_user]
        result = switch_to_remembered_account(original_account.display_name or original_account.account_name)
        restored = result.ok

    return {
        "ok": any(item.ok for item in scanned),
        "message": f"Scanned {sum(1 for item in scanned if item.ok)}/{len(scanned)} remembered accounts",
        "original_user_id32": original_user,
        "restored_original": restored,
        "accounts": [asdict(item) for item in scanned],
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "unique_app_count": len(licenses),
        "duplicate_app_count": sum(1 for labels in licenses.values() if len(labels) > 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan visible remembered Steam accounts into a local license pool")
    parser.add_argument("--no-restore", action="store_true", help="leave the last scanned Steam account active")
    parser.add_argument("--compact", action="store_true", help="omit per-account app-id lists from JSON output")
    args = parser.parse_args()
    result = scan_pool(restore_original=not args.no_restore)
    if args.compact:
        result = dict(result)
        result["accounts"] = [
            {
                "display_name": item.get("display_name"),
                "account_name": item.get("account_name"),
                "active_user_id32": item.get("active_user_id32"),
                "app_count": len(item.get("app_ids") or []),
                "ok": item.get("ok"),
                "message": item.get("message"),
            }
            for item in result.get("accounts", [])
        ]
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
