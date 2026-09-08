"""Discover remembered Steam accounts, verified owners, and locally visible apps.

Steam signals are deliberately kept separate:
- ``Software/Valve/Steam/apps`` = apps visible/known to that seat. Steam Families
  can make one purchased game appear here for several members. This is access,
  NOT another copy.
- ``apptickets``/``nettickets`` = historical/local ticket entries. They are useful
  diagnostics but are NOT proof that the remembered account owns the license.
- ``.gameaccess/verified_licenses.json`` = ownership previously verified from
  Steam's own ``licenses_print`` output, including ``Original Owner`` attribution.
  Only this verified source may populate ``app_ids`` and license copies.

If the verified cache is missing or partial, the scanner fails closed: visible
apps remain discoverable through ``accessible_app_ids`` but unverified accounts
do not become playable owners. Ticket blob values, passwords, Steam Guard
secrets, cookies, login keys and auth material are never emitted.
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
VERIFIED_LICENSES_PATH = Path(__file__).resolve().parent / ".gameaccess" / "verified_licenses.json"


@dataclass
class SteamPoolAccount:
    display_name: str
    account_name: str
    steam_id64: str
    user_id32: int | None
    # Backwards-compatible field consumed by the desktop/backend. It contains
    # only licenses verified from licenses_print / Original Owner attribution.
    app_ids: list[int]
    runnable_app_ids: list[int]
    runnable_verified: bool
    runnable_verified_at: str | None
    accessible_app_ids: list[int]
    # Ticket count is diagnostic only and must never grant ownership/playability.
    ticketed_app_count: int
    ownership_source: str
    ownership_verified: bool
    ownership_verified_at: str | None
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
    """Read identities that Steam explicitly marks as remembered on this PC."""
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
            if str(_ci_get(fields, "RememberPassword") or "").strip() != "1":
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
    """Return local app/net ticket AppIDs for diagnostics only.

    A ticket can survive borrowed, temporary or historical access. Its presence
    must never be interpreted as a current owned license.
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


def load_verified_owner_cache(path: Path = VERIFIED_LICENSES_PATH) -> dict[str, Any]:
    """Load conservative owner mappings produced by ``licenses_print`` verification."""
    result: dict[str, Any] = {
        "available": False,
        "complete": False,
        "verified_at": None,
        "source": "none",
        "owner_apps": {},
        "scanned_user_ids": set(),
        "runnable_apps": {},
        "runnable_user_ids": set(),
        "error": None,
    }
    if not path.is_file():
        result["error"] = "verified licenses_print cache is not available"
        return result
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        result["error"] = f"verified license cache could not be read: {exc}"
        return result
    if not isinstance(data, dict) or data.get("source") != "steam-console-licenses-print":
        result["error"] = "verified license cache has an unsupported ownership source"
        return result

    owner_apps: dict[int, set[int]] = {}
    scanned_user_ids: set[int] = set()
    runnable_apps: dict[int, set[int]] = {}
    runnable_user_ids: set[int] = set()
    for seat in data.get("scanned_seats") or []:
        if not isinstance(seat, dict) or not seat.get("ok"):
            continue
        try:
            user_id = int(seat.get("seat_user_id32"))
        except (TypeError, ValueError):
            continue
        if user_id <= 0:
            continue
        scanned_user_ids.add(user_id)
        if "runnable_app_ids" in seat:
            runnable_apps[user_id] = {
                int(app_id)
                for app_id in seat.get("runnable_app_ids") or []
                if str(app_id).isdigit() and int(app_id) > 0
            }
            runnable_user_ids.add(user_id)

    for owner in data.get("owners") or []:
        if not isinstance(owner, dict):
            continue
        try:
            user_id = int(owner.get("user_id32"))
        except (TypeError, ValueError):
            continue
        if user_id <= 0:
            continue
        apps = {
            int(app_id)
            for app_id in owner.get("app_ids") or []
            if str(app_id).isdigit() and int(app_id) > 0
        }
        owner_apps[user_id] = apps
        # An owner row can only come from a successfully scanned seat/original owner.
        scanned_user_ids.add(user_id)

    result.update(
        {
            "available": True,
            "complete": bool(data.get("complete")),
            "verified_at": data.get("verified_at"),
            "source": "steam-console-licenses-print-cache",
            "owner_apps": owner_apps,
            "scanned_user_ids": scanned_user_ids,
            "runnable_apps": runnable_apps,
            "runnable_user_ids": runnable_user_ids,
        }
    )
    if not result["complete"]:
        result["error"] = "verified ownership cache is partial; unscanned accounts are treated as unverified"
    return result


def scan_pool() -> dict[str, Any]:
    active_user = active_user_id32()
    identities = remembered_account_identities()
    verified = load_verified_owner_cache()
    owner_apps: dict[int, set[int]] = verified["owner_apps"]
    verified_users: set[int] = verified["scanned_user_ids"]
    runnable_apps: dict[int, set[int]] = verified.get("runnable_apps") or {}
    runnable_users: set[int] = verified.get("runnable_user_ids") or set()
    scanned: list[SteamPoolAccount] = []

    for identity in identities:
        user_id = identity.get("user_id32")
        accessible = local_library_apps(user_id) if isinstance(user_id, int) else {}
        ticketed = local_ticketed_apps(user_id) if isinstance(user_id, int) else set()
        accessible_ids = sorted(accessible)
        ownership_verified = isinstance(user_id, int) and user_id in verified_users
        owned_ids = sorted(owner_apps.get(user_id, set())) if ownership_verified else []
        runnable_verified = isinstance(user_id, int) and user_id in runnable_users
        runnable_set = set(runnable_apps.get(user_id, set())) if runnable_verified else set()
        # Backward-compatible safe fallback: a verified original owner can run its own license.
        if ownership_verified:
            runnable_set.update(owned_ids)
        runnable_ids = sorted(runnable_set)
        runnable_verified = runnable_verified or bool(ownership_verified and owned_ids)
        ok = bool(user_id) and bool(accessible_ids or owned_ids or runnable_ids)
        ownership_message = (
            f"{len(owned_ids)} licenses verified by licenses_print"
            if ownership_verified
            else "ownership not verified; local ticket keys are ignored for playability"
        )
        scanned.append(
            SteamPoolAccount(
                display_name=identity.get("display_name") or identity.get("account_name") or "Steam",
                account_name=identity.get("account_name") or "",
                steam_id64=identity.get("steam_id64") or "",
                user_id32=user_id if isinstance(user_id, int) else None,
                app_ids=owned_ids,
                runnable_app_ids=runnable_ids,
                runnable_verified=runnable_verified,
                runnable_verified_at=verified["verified_at"] if runnable_verified else None,
                accessible_app_ids=accessible_ids,
                ticketed_app_count=len(ticketed),
                ownership_source=verified["source"] if ownership_verified else "unverified",
                ownership_verified=ownership_verified,
                ownership_verified_at=verified["verified_at"] if ownership_verified else None,
                active=bool(user_id and user_id == active_user),
                ok=ok,
                message=(
                    f"{len(accessible_ids)} accessible app entries; "
                    f"{len(ticketed)} local ticket entries (diagnostic only); {ownership_message}"
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

    verified_account_count = sum(1 for item in scanned if item.ownership_verified)
    runnable_account_count = sum(1 for item in scanned if item.runnable_verified)
    return {
        "ok": any(item.ok for item in scanned),
        "message": (
            f"Scanned {sum(1 for item in scanned if item.ok)}/{len(scanned)} remembered accounts; "
            f"ownership verified for {verified_account_count}/{len(scanned)}. "
            "License copies come only from licenses_print verification; Steam ticket keys never grant playability."
        ),
        "active_user_id32": active_user,
        "accounts": [asdict(item) for item in scanned],
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "unique_app_count": len(licenses),
        "accessible_app_count": len(accessible_union),
        "duplicate_app_count": sum(1 for labels in licenses.values() if len(labels) > 1),
        "ownership_error": verified.get("error"),
        "ownership_source": verified["source"],
        "ownership_verified_at": verified["verified_at"],
        "ownership_complete": verified["complete"],
        "verified_account_count": verified_account_count,
        "runnable_account_count": runnable_account_count,
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
                "runnable_app_count": len(item.get("runnable_app_ids") or []),
                "runnable_verified": item.get("runnable_verified", False),
                "accessible_app_count": len(item.get("accessible_app_ids") or []),
                "ticketed_app_count": item.get("ticketed_app_count", 0),
                "ownership_source": item.get("ownership_source"),
                "ownership_verified": item.get("ownership_verified", False),
                "ownership_verified_at": item.get("ownership_verified_at"),
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
