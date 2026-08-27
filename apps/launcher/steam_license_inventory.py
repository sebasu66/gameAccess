"""Build verified Steam license ownership from the Steam client's own console.

Steam Families makes a borrowed game visible in a member's library, so local
``Software/Valve/Steam/apps`` and app tickets are not a license inventory.
``licenses_print`` is different: Steam itself labels borrowed licenses and emits
``Original Owner``. We use that distinction and count a copy once per
(owner Steam user id, top-level Windows game AppID).

No passwords, Steam Guard secrets, cookies or auth material are read or stored.
The parser consumes only Steam console output about package/license ownership.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from steam_appinfo import read_local_app_catalog
from steam_console_command import run_console_command
from steam_pool import remembered_account_identities, steam_root

_TIMESTAMP = re.compile(r"^\[[^\]]+\]\s*")
_PACKAGE = re.compile(r"^License packageID\s+(\d+)\s*:\s*$", re.IGNORECASE)
_OWNER = re.compile(r"^-\s*Original Owner\s*:\s*(\d+)\s*$", re.IGNORECASE)
_APP_ID = re.compile(r"^(\d+)\s*,?\s*$")


@dataclass
class ConsoleLicense:
    package_id: int
    borrowed: bool = False
    original_owner_user_id32: int | None = None
    apps: set[int] = field(default_factory=set)
    state_lines: list[str] = field(default_factory=list)
    purchase_line: str = ""


def _clean(line: str) -> str:
    return _TIMESTAMP.sub("", line).strip()


def parse_licenses_print(lines: list[str], active_user_id32: int) -> list[ConsoleLicense]:
    records: list[ConsoleLicense] = []
    current: ConsoleLicense | None = None
    section = ""

    def finish() -> None:
        nonlocal current
        if current is not None:
            records.append(current)
            current = None

    for raw in lines:
        line = _clean(raw)
        match = _PACKAGE.match(line)
        if match:
            finish()
            current = ConsoleLicense(package_id=int(match.group(1)))
            section = ""
            continue
        if current is None:
            continue

        owner = _OWNER.match(line)
        if owner:
            current.original_owner_user_id32 = int(owner.group(1))
            continue
        if "borrowed" in line.casefold():
            current.borrowed = True
        if line.casefold().startswith("- purchased"):
            current.purchase_line = line
            continue
        if re.match(r"^-\s*apps\b", line, flags=re.IGNORECASE):
            section = "apps"
            continue
        if re.match(r"^-\s*depots\b", line, flags=re.IGNORECASE):
            section = "depots"
            continue
        if line.startswith("-"):
            section = ""
        if section == "apps":
            app = _APP_ID.match(line)
            if app:
                current.apps.add(int(app.group(1)))
                continue
            if "in total" in line.casefold():
                section = ""
                continue
        if section == "" and line and not line.startswith("("):
            if len(current.state_lines) < 12:
                current.state_lines.append(line)

    finish()

    # A borrowed record without Original Owner cannot be attributed safely.
    return [
        record
        for record in records
        if not record.borrowed or record.original_owner_user_id32 is not None
    ]


def _windows_game_catalog(app_ids: set[int]) -> dict[int, dict[str, Any]]:
    root = steam_root()
    path = root / "appcache" / "appinfo.vdf" if root else Path("__missing__")
    if not path.is_file() or not app_ids:
        return {}
    raw = read_local_app_catalog(path, app_ids)
    games: dict[int, dict[str, Any]] = {}
    for app_id, item in raw.items():
        if str(item.get("type") or "").casefold() != "game":
            continue
        oslist = str(item.get("oslist") or "").casefold()
        if oslist and "windows" not in oslist:
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        games[app_id] = item
    return games


def inventory_from_active_account(wait_seconds: float = 6.0) -> dict[str, Any]:
    result = run_console_command(["licenses_print"], wait_seconds, max_lines=None)
    active_user = int(result.get("active_user_id32") or 0)
    if active_user <= 0:
        raise RuntimeError("Steam has no active signed-in user")

    records = parse_licenses_print(result.get("lines") or [], active_user)
    all_apps = {app for record in records for app in record.apps}
    catalog = _windows_game_catalog(all_apps)
    game_ids = set(catalog)

    identities = remembered_account_identities()
    identity_by_user = {
        int(item["user_id32"]): item
        for item in identities
        if isinstance(item.get("user_id32"), int)
    }

    owner_games: dict[int, set[int]] = {}
    owner_packages: dict[int, set[int]] = {}
    borrowed_package_count = 0
    unattributed_borrowed = 0
    for record in records:
        if record.borrowed:
            borrowed_package_count += 1
            owner = record.original_owner_user_id32
            if owner is None:
                unattributed_borrowed += 1
                continue
        else:
            owner = active_user
        owner_packages.setdefault(owner, set()).add(record.package_id)
        for app_id in record.apps:
            if app_id in game_ids:
                owner_games.setdefault(owner, set()).add(app_id)

    owners = []
    for owner_user, apps in sorted(owner_games.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        identity = identity_by_user.get(owner_user) or {}
        owners.append(
            {
                "user_id32": owner_user,
                "steam_id64": identity.get("steam_id64"),
                "label": identity.get("display_name") or identity.get("account_name") or str(owner_user),
                "account_name": identity.get("account_name"),
                "remembered": bool(identity),
                "package_count": len(owner_packages.get(owner_user, set())),
                "game_count": len(apps),
                "app_ids": sorted(apps),
            }
        )

    owner_app_pairs = {(owner, app) for owner, apps in owner_games.items() for app in apps}
    return {
        "ok": True,
        "source": "steam-console-licenses-print",
        "active_user_id32": active_user,
        "active_identity": result.get("active_identity"),
        "console_line_count": result.get("line_count"),
        "package_records": len(records),
        "borrowed_package_records": borrowed_package_count,
        "unattributed_borrowed_records": unattributed_borrowed,
        "unique_windows_games": len({app for _owner, app in owner_app_pairs}),
        "license_mappings": len(owner_app_pairs),
        "owners": owners,
        "games": [
            {
                "app_id": app_id,
                "name": catalog[app_id].get("name") or str(app_id),
                "developer": catalog[app_id].get("developer") or "",
                "publisher": catalog[app_id].get("publisher") or "",
            }
            for app_id in sorted({app for _owner, app in owner_app_pairs})
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read verified Steam license ownership from licenses_print")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--app-id", type=int)
    args = parser.parse_args()

    inventory = inventory_from_active_account()
    if args.app_id:
        app_id = args.app_id
        owners = [owner for owner in inventory["owners"] if app_id in set(owner["app_ids"])]
        inventory = {
            "ok": True,
            "source": inventory["source"],
            "app_id": app_id,
            "copies": len(owners),
            "owners": [
                {
                    "user_id32": owner["user_id32"],
                    "label": owner["label"],
                    "account_name": owner.get("account_name"),
                }
                for owner in owners
            ],
            "active_identity": inventory["active_identity"],
        }
    elif args.compact:
        inventory = {
            key: value
            for key, value in inventory.items()
            if key not in {"games"}
        }
        inventory["owners"] = [
            {key: value for key, value in owner.items() if key != "app_ids"}
            for owner in inventory["owners"]
        ]
    print(json.dumps(inventory, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
