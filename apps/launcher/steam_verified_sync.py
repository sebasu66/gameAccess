"""Verify real Steam license ownership across remembered accounts and sync gameAccess.

The authoritative source is Steam's own ``licenses_print`` console command.
Borrowed Steam Family packages are attributed to ``Original Owner`` and never
counted as extra copies. Library visibility remains a separate seat/access
signal.

This maintenance operation may force-close Steam if its normal shutdown hangs;
it is intended for explicit admin verification, not background polling.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from steam_console_command import run_console_command
from steam_license_inventory import parse_licenses_print, _windows_game_catalog
from steam_pool import active_user_id32, remembered_account_identities, scan_pool
from steam_switch import select_remembered_account, start_steam, switch_to_remembered_account

CACHE_DIR = Path(__file__).resolve().parent / ".gameaccess"
CACHE_PATH = CACHE_DIR / "verified_licenses.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def wait_for_active(expected: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if active_user_id32() == expected:
            return True
        time.sleep(0.5)
    return False


def force_close_steam() -> None:
    subprocess.run(
        ["taskkill", "/F", "/T", "/IM", "steam.exe"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    time.sleep(2.0)


def switch_verified(identity: dict[str, Any]) -> tuple[bool, str]:
    user_id = int(identity["user_id32"])
    if active_user_id32() == user_id:
        return True, "already active"
    target = str(identity.get("account_name") or identity.get("display_name") or "").strip()
    if not target:
        return False, "missing account label"

    first = switch_to_remembered_account(target)
    if first.ok and wait_for_active(user_id):
        time.sleep(2.0)
        return True, first.message

    # Steam's normal exit can hang after console activity. For this explicit
    # verification operation, force-close the client and retry from a clean
    # remembered-account chooser. No credentials are entered or read.
    force_close_steam()
    started = start_steam()
    if not started.ok:
        return False, f"force restart failed: {started.stage}: {started.message}"
    time.sleep(4.0)
    selected = select_remembered_account(target, timeout=35.0)
    if not selected.ok:
        return False, f"forced chooser select failed: {selected.stage}: {selected.message}"
    if not wait_for_active(user_id, timeout=50.0):
        return False, f"selected {target} but ActiveUser did not become {user_id}"
    time.sleep(2.0)
    return True, "selected after forced Steam restart"


def scan_current(identity: dict[str, Any]) -> dict[str, Any]:
    expected = int(identity["user_id32"])
    console = run_console_command(["licenses_print"], 8.0, max_lines=None)
    actual = int(console.get("active_user_id32") or 0)
    if actual != expected:
        raise RuntimeError(f"Steam active user changed during scan: expected {expected}, got {actual}")
    records = parse_licenses_print(console.get("lines") or [], actual)
    return {
        "seat_user_id32": actual,
        "seat_label": identity.get("display_name") or identity.get("account_name") or str(actual),
        "package_records": len(records),
        "borrowed_package_records": sum(1 for record in records if record.borrowed),
        "console_line_count": int(console.get("line_count") or 0),
        "records": records,
    }


def verify_inventory() -> dict[str, Any]:
    identities = [item for item in remembered_account_identities() if isinstance(item.get("user_id32"), int)]
    if not identities:
        raise RuntimeError("Steam has no remembered accounts")

    original_user = active_user_id32()
    identity_by_user = {int(item["user_id32"]): item for item in identities}
    ordered = sorted(identities, key=lambda item: 0 if item.get("user_id32") == original_user else 1)
    owner_apps_raw: dict[int, set[int]] = {}
    scanned: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for identity in ordered:
        user_id = int(identity["user_id32"])
        ok, message = switch_verified(identity)
        if not ok:
            errors.append({"user_id32": user_id, "label": identity.get("display_name"), "error": message})
            continue
        try:
            result = scan_current(identity)
        except Exception as exc:
            errors.append({"user_id32": user_id, "label": identity.get("display_name"), "error": str(exc)})
            continue

        owners_seen: set[int] = set()
        for record in result.pop("records"):
            owner = record.original_owner_user_id32 if record.borrowed else user_id
            if owner is None:
                continue
            owners_seen.add(owner)
            owner_apps_raw.setdefault(int(owner), set()).update(record.apps)
        result["owners_seen"] = sorted(owners_seen)
        result["ok"] = True
        result["switch"] = message
        scanned.append(result)

    # Restore the account that was active before verification when possible.
    restore_error = None
    if isinstance(original_user, int) and original_user > 0 and active_user_id32() != original_user:
        original_identity = identity_by_user.get(original_user)
        if original_identity:
            ok, message = switch_verified(original_identity)
            if not ok:
                restore_error = message

    all_owner_apps = {app_id for apps in owner_apps_raw.values() for app_id in apps}
    owned_catalog = _windows_game_catalog(all_owner_apps)
    windows_owned_ids = set(owned_catalog)
    owner_apps = {
        owner: {app_id for app_id in apps if app_id in windows_owned_ids}
        for owner, apps in owner_apps_raw.items()
    }

    owners = []
    mappings = []
    for owner, apps in sorted(owner_apps.items(), key=lambda pair: (-len(pair[1]), pair[0])):
        identity = identity_by_user.get(owner) or {}
        owners.append({
            "user_id32": owner,
            "steam_id64": identity.get("steam_id64"),
            "label": identity.get("display_name") or identity.get("account_name") or str(owner),
            "account_name": identity.get("account_name"),
            "remembered": bool(identity),
            "game_count": len(apps),
            "app_ids": sorted(apps),
        })
        mappings.extend({"owner_user_id32": owner, "app_id": app_id} for app_id in sorted(apps))

    result = {
        "ok": bool(scanned),
        "complete": len(scanned) == len(identities) and not errors,
        "source": "steam-console-licenses-print",
        "verified_at": now_iso(),
        "original_active_user_id32": original_user,
        "final_active_user_id32": active_user_id32(),
        "remembered_account_count": len(identities),
        "scanned_account_count": len(scanned),
        "unique_windows_games": len({item["app_id"] for item in mappings}),
        "license_mappings": len(mappings),
        "owners": owners,
        "mappings": mappings,
        "scanned_seats": scanned,
        "errors": errors,
        "restore_error": restore_error,
    }
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def build_sync_payload(inventory: dict[str, Any]) -> dict[str, Any]:
    if not inventory.get("complete"):
        raise RuntimeError("verified inventory is incomplete; refusing to replace backend license mappings")

    identities = remembered_account_identities()
    identities_by_user = {
        int(item["user_id32"]): item
        for item in identities
        if isinstance(item.get("user_id32"), int)
    }
    raw_access = scan_pool()
    access_by_user = {
        int(item["user_id32"]): set(item.get("accessible_app_ids") or [])
        for item in raw_access.get("accounts", [])
        if isinstance(item.get("user_id32"), int)
    }
    owner_apps = {
        int(owner["user_id32"]): set(owner.get("app_ids") or [])
        for owner in inventory.get("owners", [])
    }

    candidate_ids: set[int] = set()
    for apps in access_by_user.values():
        candidate_ids.update(int(app_id) for app_id in apps)
    for apps in owner_apps.values():
        candidate_ids.update(int(app_id) for app_id in apps)
    catalog = _windows_game_catalog(candidate_ids)
    game_ids = set(catalog)

    all_users = set(identities_by_user) | set(owner_apps)
    accounts = []
    for user_id in sorted(all_users):
        identity = identities_by_user.get(user_id) or {}
        owned = sorted(app_id for app_id in owner_apps.get(user_id, set()) if app_id in game_ids)
        accessible = sorted(app_id for app_id in access_by_user.get(user_id, set()) if app_id in game_ids)
        accounts.append({
            "label": identity.get("display_name") or identity.get("account_name") or str(user_id),
            "account_name": identity.get("account_name") or "",
            "steam_id64": identity.get("steam_id64") or "",
            "user_id32": user_id,
            "app_ids": owned,
            "accessible_app_ids": accessible,
            "ticketed_app_count": 0,
            "ownership_source": "steam-console-licenses-print",
            "active": user_id == active_user_id32(),
        })

    games = [
        {
            "app_id": app_id,
            "name": catalog[app_id].get("name") or str(app_id),
            "developer": catalog[app_id].get("developer") or "",
            "publisher": catalog[app_id].get("publisher") or "",
        }
        for app_id in sorted(game_ids)
    ]
    return {"source": "steam-console-licenses-print", "accounts": accounts, "games": games}


def sync_backend(payload: dict[str, Any], api: str) -> dict[str, Any]:
    response = requests.post(f"{api.rstrip('/')}/admin/pool/sync", json=payload, timeout=60)
    response.raise_for_status()
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--assert-app", type=int)
    parser.add_argument("--assert-copies", type=int)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()

    inventory = verify_inventory()
    if not inventory.get("complete"):
        print(json.dumps({"ok": False, "stage": "verify", "inventory": inventory}, ensure_ascii=False))
        return 2

    if args.assert_app is not None and args.assert_copies is not None:
        owners = {
            int(mapping["owner_user_id32"])
            for mapping in inventory.get("mappings", [])
            if int(mapping.get("app_id") or 0) == args.assert_app
        }
        if len(owners) != args.assert_copies:
            print(json.dumps({
                "ok": False,
                "stage": "assert",
                "app_id": args.assert_app,
                "expected_copies": args.assert_copies,
                "actual_copies": len(owners),
                "owners": sorted(owners),
            }, ensure_ascii=False))
            return 3

    payload = build_sync_payload(inventory)
    backend = sync_backend(payload, args.api)
    output = {
        "ok": True,
        "inventory": {
            "complete": inventory["complete"],
            "remembered_accounts": inventory["remembered_account_count"],
            "scanned_accounts": inventory["scanned_account_count"],
            "unique_windows_games": inventory["unique_windows_games"],
            "license_mappings": inventory["license_mappings"],
            "owners": [
                {"label": owner["label"], "user_id32": owner["user_id32"], "game_count": owner["game_count"]}
                for owner in inventory.get("owners", [])
            ],
            "restore_error": inventory.get("restore_error"),
        },
        "catalog_games": len(payload["games"]),
        "backend": backend,
    }
    print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
