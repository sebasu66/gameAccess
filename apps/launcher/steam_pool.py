"""Discover Steam accounts, true licenses, and family-visible apps locally.

The important distinction is:
- ``Apps`` in each user's localconfig is *accessible/known library state*. Steam
  Families can make one purchased game appear there for several family members.
  It is useful for seat visibility, but it is NOT proof of another copy.
- ``Licenses`` in localconfig is keyed by package/subscription ID. We read only
  those numeric keys (never their values) and resolve them through Steam's local
  ``appcache/packageinfo.vdf``. Those resolved AppIDs are the ownership source
  used by gameAccess license counting.

Remembered account identity comes from ``config/loginusers.vdf`` and is limited
to SteamID, AccountName and PersonaName. This scanner intentionally does not
emit passwords, Steam Guard secrets, cookies, login keys, tokens, auth blobs,
RememberPassword, or license values.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from steam_packageinfo import PackageInfoError, read_package_app_map
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
    # Backwards-compatible field consumed by pool_sync/backend. From now on it
    # means TRUE OWNED apps resolved from package licenses, never visible Apps.
    app_ids: list[int]
    accessible_app_ids: list[int]
    license_package_count: int
    unresolved_package_count: int
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


def local_license_package_ids(user_id32: int) -> set[int]:
    """Read only numeric KEYS of localconfig/Licenses; never license values."""
    parsed = _localconfig(user_id32)
    licenses = _largest_named_numeric_block(parsed, "licenses")
    if not isinstance(licenses, dict):
        return set()
    package_ids: set[int] = set()
    for key in licenses:
        text = str(key).strip()
        if text.isdigit():
            package_id = int(text)
            if package_id > 0:
                package_ids.add(package_id)
    return package_ids


def scan_pool() -> dict[str, Any]:
    active_user = active_user_id32()
    identities = remembered_account_identities()
    root = steam_root()

    raw_accounts: list[dict[str, Any]] = []
    all_package_ids: set[int] = set()
    for identity in identities:
        user_id = identity.get("user_id32")
        accessible = local_library_apps(user_id) if isinstance(user_id, int) else {}
        package_ids = local_license_package_ids(user_id) if isinstance(user_id, int) else set()
        all_package_ids.update(package_ids)
        raw_accounts.append(
            {
                **identity,
                "accessible_app_ids": sorted(accessible),
                "package_ids": package_ids,
            }
        )

    package_map: dict[int, set[int]] = {}
    globally_unresolved: set[int] = set(all_package_ids)
    ownership_error = ""
    packageinfo_path = root / "appcache" / "packageinfo.vdf" if root else Path("__missing__")
    if all_package_ids and packageinfo_path.is_file():
        try:
            package_map, globally_unresolved = read_package_app_map(packageinfo_path, all_package_ids)
        except (OSError, EOFError, PackageInfoError, ValueError) as exc:
            # Fail closed: visible Family apps must never be promoted to licenses
            # merely because ownership resolution failed.
            ownership_error = str(exc)
            package_map = {}
            globally_unresolved = set(all_package_ids)
    elif all_package_ids:
        ownership_error = "Steam appcache/packageinfo.vdf was not found"

    scanned: list[SteamPoolAccount] = []
    for item in raw_accounts:
        package_ids: set[int] = item["package_ids"]
        owned: set[int] = set()
        for package_id in package_ids:
            owned.update(package_map.get(package_id, set()))
        unresolved_count = sum(1 for package_id in package_ids if package_id in globally_unresolved)
        user_id = item.get("user_id32")
        accessible_ids: list[int] = item["accessible_app_ids"]
        ok = bool(user_id) and bool(accessible_ids or package_ids)
        ownership_source = "steam-license-packages" if package_map else "unresolved"
        message_parts = [
            f"{len(accessible_ids)} accessible app entries",
            f"{len(owned)} owned apps from {len(package_ids)} license packages",
        ]
        if unresolved_count:
            message_parts.append(f"{unresolved_count} unresolved packages")
        scanned.append(
            SteamPoolAccount(
                display_name=item.get("display_name") or item.get("account_name") or "Steam",
                account_name=item.get("account_name") or "",
                steam_id64=item.get("steam_id64") or "",
                user_id32=user_id if isinstance(user_id, int) else None,
                app_ids=sorted(owned),
                accessible_app_ids=accessible_ids,
                license_package_count=len(package_ids),
                unresolved_package_count=unresolved_count,
                ownership_source=ownership_source,
                active=bool(user_id and user_id == active_user),
                ok=ok,
                message="; ".join(message_parts),
            )
        )

    # LICENSES are built only from package-resolved ownership. Family-visible
    # duplicates remain represented only as accessible_app_ids on seats.
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
        "message": f"Scanned {sum(1 for item in scanned if item.ok)}/{len(scanned)} remembered accounts; ownership is resolved from Steam license packages",
        "active_user_id32": active_user,
        "accounts": [asdict(item) for item in scanned],
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "unique_app_count": len(licenses),
        "accessible_app_count": len(accessible_union),
        "duplicate_app_count": sum(1 for labels in licenses.values() if len(labels) > 1),
        "license_package_count": len(all_package_ids),
        "unresolved_package_count": len(globally_unresolved),
        "ownership_error": ownership_error or None,
        "ownership_source": "steam-license-packages",
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
                "license_package_count": item.get("license_package_count", 0),
                "unresolved_package_count": item.get("unresolved_package_count", 0),
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
