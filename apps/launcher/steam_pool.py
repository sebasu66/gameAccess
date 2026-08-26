"""Discover the local Steam account/game pool without reading credentials.

The scanner reads only non-secret local metadata:
- Steam's remembered-account identity fields from config/loginusers.vdf
  (SteamID, AccountName, PersonaName only);
- each user's localconfig.vdf *apps* section, which contains local library/play
  metadata;
- HKCU\\Software\\Valve\\Steam\\ActiveProcess\\ActiveUser for the currently
  active local user id.

It intentionally does not read or emit passwords, Steam Guard secrets, cookies,
login keys, tokens, auth blobs, RememberPassword, WantsOfflineMode, timestamps,
or any other login/session material.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from steam_switch import find_steam_exe

if os.name == "nt":
    import winreg
else:  # pragma: no cover - Windows-only MVP
    winreg = None

STEAM_ID64_BASE = 76561197960265728


@dataclass
class SteamPoolAccount:
    display_name: str
    account_name: str
    steam_id64: str
    user_id32: int | None
    app_ids: list[int]
    active: bool
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
    token_re = re.compile(r'"((?:\\.|[^"\\])*)"|([{}])')
    tokens: list[str] = []
    for match in token_re.finditer(text):
        if match.group(2):
            tokens.append(match.group(2))
        else:
            # VDF uses escaped backslashes/quotes; we only need structural text.
            value = match.group(1).replace(r"\\", "\\").replace(r'\"', '"')
            tokens.append(value)
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


def _read_vdf(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    parsed, _ = _parse_vdf_object(_tokenize_vdf(text))
    return parsed


def remembered_account_identities() -> list[dict[str, Any]]:
    """Read only public identity fields from Steam's remembered-account list."""
    root = steam_root()
    if not root:
        return []
    path = root / "config" / "loginusers.vdf"
    if not path.is_file():
        return []
    try:
        parsed = _read_vdf(path)
        users = _ci_get(parsed, "users")
        if not isinstance(users, dict):
            return []
        result: list[dict[str, Any]] = []
        for steam_id64, fields in users.items():
            if not str(steam_id64).isdigit() or not isinstance(fields, dict):
                continue
            account_name = str(_ci_get(fields, "AccountName") or "").strip()
            persona_name = str(_ci_get(fields, "PersonaName") or account_name).strip()
            steam64 = int(steam_id64)
            user32 = steam64 - STEAM_ID64_BASE if steam64 >= STEAM_ID64_BASE else None
            if user32 is not None and user32 <= 0:
                user32 = None
            result.append(
                {
                    "steam_id64": str(steam_id64),
                    "user_id32": user32,
                    "account_name": account_name,
                    "display_name": persona_name,
                }
            )
        return result
    except Exception:
        return []


def local_library_apps(user_id32: int) -> dict[int, dict[str, Any]]:
    root = steam_root()
    if not root:
        return {}
    path = root / "userdata" / str(user_id32) / "config" / "localconfig.vdf"
    if not path.is_file():
        return {}
    try:
        parsed = _read_vdf(path)
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


def scan_pool() -> dict[str, Any]:
    active_user = active_user_id32()
    identities = remembered_account_identities()
    scanned: list[SteamPoolAccount] = []

    for identity in identities:
        user_id = identity.get("user_id32")
        apps = local_library_apps(user_id) if isinstance(user_id, int) else {}
        ok = bool(user_id) and bool(apps)
        scanned.append(
            SteamPoolAccount(
                display_name=identity.get("display_name") or identity.get("account_name") or "Steam",
                account_name=identity.get("account_name") or "",
                steam_id64=identity.get("steam_id64") or "",
                user_id32=user_id if isinstance(user_id, int) else None,
                app_ids=sorted(apps),
                active=bool(user_id and user_id == active_user),
                ok=ok,
                message=(
                    f"Discovered {len(apps)} local library app entries"
                    if ok
                    else "No local library app metadata was found for this remembered account"
                ),
            )
        )

    licenses: dict[int, list[str]] = {}
    for item in scanned:
        if not item.ok:
            continue
        label = item.display_name or item.account_name
        for app_id in item.app_ids:
            licenses.setdefault(app_id, []).append(label)

    return {
        "ok": any(item.ok for item in scanned),
        "message": f"Scanned {sum(1 for item in scanned if item.ok)}/{len(scanned)} remembered accounts from local metadata",
        "active_user_id32": active_user,
        "accounts": [asdict(item) for item in scanned],
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "unique_app_count": len(licenses),
        "duplicate_app_count": sum(1 for labels in licenses.values() if len(labels) > 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan remembered Steam accounts into a local game/license pool")
    parser.add_argument("--compact", action="store_true", help="omit per-account app-id lists and license detail")
    args = parser.parse_args()
    result = scan_pool()
    if args.compact:
        result = dict(result)
        result["accounts"] = [
            {
                "display_name": item.get("display_name"),
                "account_name": item.get("account_name"),
                "user_id32": item.get("user_id32"),
                "app_count": len(item.get("app_ids") or []),
                "active": item.get("active"),
                "ok": item.get("ok"),
                "message": item.get("message"),
            }
            for item in result.get("accounts", [])
        ]
        result.pop("licenses", None)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
