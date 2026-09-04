"""Discover Steam accounts, owned licenses, and Family-visible apps locally.

Two Steam signals are deliberately kept separate:
- ``Software/Valve/Steam/apps`` = apps visible/known to that seat. Steam Families
  can make one purchased game appear here for several members. This is access,
  NOT another copy.
- ``apptickets``/``nettickets`` = Steam app ownership/access ticket entries.
  These are used as the local owner signal for license counting. This matches
  how current Steam account-switcher tooling identifies per-account owners.

The scanner reads only key names/IDs from ticket sections; it does not emit the
actual ticket blobs, passwords, Steam Guard secrets, cookies, login keys, auth
blobs, RememberPassword, or other session material.
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
    # Backwards-compatible field consumed by pool_sync/backend. It now means
    # ticket-backed owned apps, never Family-visible Apps.
    app_ids: list[int]
    accessible_app_ids: list[int]
    ticketed_app_count: int
    ownership_source: str
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


def _largest_named_numeric_block(node: Any, wanted_name: str) -> dict[str, Any] | None:
    """Find the largest named VDF object whose direct keys are numeric."""
    best: dict[str, Any] | None = None
    best_count = 0
    folded = wanted_name.casefold()

    def visit(value: Any) -> None:
        nonlocal best, best_count
        if not isinstance(value, dict):
            return
        for key, child in value.items():
            if str(key).casefold() == folded and isinstance(child, dict):
                count = sum(1 for child_key in child if str(child_key).isdigit())
                if count > best_count:
                    best = child
                    best_count = count
            visit(child)

    visit(node)
    return best


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
            remember_raw = str(_ci_get(fields, "RememberPassword") or "").strip().casefold()
            remember_password = remember_raw in {"1", "true", "yes"}
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
                    "remember_password": remember_password,
                    "is_personal": remember_password,
                }
            )
        return result
    except Exception:
        return []


def personal_account_identities() -> list[dict[str, Any]]:
    """Return only personal/local Steam accounts.

    Per the Game Access account-classification contract, RememberPassword=1 is
    the sole local/personal signal. Steam Guard state is intentionally ignored.
    """
    return [item for item in remembered_account_identities() if item.get("remember_password") is True]


def _localconfig(user_id32: int) -> dict[str, Any]:
    root = steam_root()
    if not root:
        return {}
    path = root / "userdata" / str(user_id32) / "config" / "localconfig.vdf"
    if not path.is_file():
        return {}
    try:
        return _read_vdf(path)
    except Exception:
        return {}


def local_library_apps(user_id32: int) -> dict[int, dict[str, Any]]:
    """Return apps visible/known to this user. NOT an ownership assertion."""
    parsed = _localconfig(user_id32)
    apps = _largest_named_numeric_block(parsed, "apps")
    if not isinstance(apps, dict):
        return {}
    result: dict[int, dict[str, Any]] = {}
    for key, value in apps.items():
        if str(key).isdigit():
            result[int(key)] = value if isinstance(value, dict) else {}
    return result


def local_ticketed_apps(user_id32: int) -> set[int]:
    """Return AppIDs present as keys in Steam's local app/net ticket sections.

    We intentionally read only the numeric key names, never ticket blob values.
    ``apptickets`` is the primary ownership signal; ``nettickets`` is included as
    a fallback because current Steam account-switcher tooling treats both as
    per-user ticket-backed ownership/access evidence.
    """
    parsed = _localconfig(user_id32)
    result: set[int] = set()
    for section in ("apptickets", "nettickets"):
        block = _largest_named_numeric_block(parsed, section)
        if not isinstance(block, dict):
            continue
        for key in block:
            text = str(key).strip()
            if text.isdigit():
                app_id = int(text)
                if app_id > 0:
                    result.add(app_id)
    return result


def scan_pool() -> dict[str, Any]:
    active_user = active_user_id32()
    identities = remembered_account_identities()
    scanned: list[SteamPoolAccount] = []

    for identity in identities:
        user_id = identity.get("user_id32")
        accessible = local_library_apps(user_id) if isinstance(user_id, int) else {}
        ticketed = local_ticketed_apps(user_id) if isinstance(user_id, int) else set()
        accessible_ids = sorted(accessible)
        owned_ids = sorted(ticketed)
        ok = bool(user_id) and bool(accessible_ids or owned_ids)
        scanned.append(
            SteamPoolAccount(
                display_name=identity.get("display_name") or identity.get("account_name") or "Steam",
                account_name=identity.get("account_name") or "",
                steam_id64=identity.get("steam_id64") or "",
                user_id32=user_id if isinstance(user_id, int) else None,
                app_ids=owned_ids,
                accessible_app_ids=accessible_ids,
                ticketed_app_count=len(owned_ids),
                ownership_source="steam-local-app-ticket-keys",
                active=bool(user_id and user_id == active_user),
                ok=ok,
                message=(
                    f"{len(accessible_ids)} accessible app entries; "
                    f"{len(owned_ids)} ticket-backed owned app entries"
                ),
            )
        )

    licenses: dict[int, list[str]] = {}
    accessible_union: set[int] = set()
    for item in scanned:
        accessible_union.update(item.accessible_app_ids)
        if not item.ok:
            continue
        label = item.display_name or item.account_name
        for app_id in item.app_ids:
            licenses.setdefault(app_id, []).append(label)

    return {
        "ok": any(item.ok for item in scanned),
        "message": (
            f"Scanned {sum(1 for item in scanned if item.ok)}/{len(scanned)} remembered accounts; "
            "license copies are counted from Steam app/net ticket keys, not Family-visible Apps"
        ),
        "active_user_id32": active_user,
        "accounts": [asdict(item) for item in scanned],
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "unique_app_count": len(licenses),
        "accessible_app_count": len(accessible_union),
        "duplicate_app_count": sum(1 for labels in licenses.values() if len(labels) > 1),
        "ownership_error": None,
        "ownership_source": "steam-local-app-ticket-keys",
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
                "owned_app_count": len(item.get("app_ids") or []),
                "accessible_app_count": len(item.get("accessible_app_ids") or []),
                "ticketed_app_count": item.get("ticketed_app_count", 0),
                "ownership_source": item.get("ownership_source"),
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
