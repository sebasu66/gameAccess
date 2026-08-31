"""Build and synchronize the local Steam pool.

Catalog reach and license ownership are different resources:
- ``accessible_app_ids`` comes from per-seat Steam library metadata and may
  include Steam Family sharing;
- true copy ownership comes only from the verified ``licenses_print`` snapshot,
  where Steam marks borrowed licenses and reports ``Original Owner``.

App/net ticket caches are deliberately NOT used as inventory: they are neither
complete nor ownership-authoritative.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import requests

from steam_appinfo import read_local_app_catalog
from steam_pool import _ci_get, _read_vdf, scan_pool, steam_root
from steam_verified_inventory import load_verified_inventory, verify_all_remembered_accounts


def _verified_owner_apps(inventory: dict[str, Any] | None) -> dict[int, set[int]]:
    result: dict[int, set[int]] = {}
    if not inventory:
        return result
    for owner in inventory.get("owners", []):
        user_id = owner.get("user_id32")
        if not isinstance(user_id, int):
            continue
        result[user_id] = {int(app_id) for app_id in owner.get("app_ids", []) if int(app_id) > 0}
    return result


def _steam_library_folders(root: Path | None) -> list[dict[str, Any]]:
    if not root:
        return []
    path = root / "steamapps" / "libraryfolders.vdf"
    try:
        parsed = _read_vdf(path)
    except (OSError, ValueError):
        return [{"index": 0, "path": str(root), "label": str(root)}]

    folders = _ci_get(parsed, "libraryfolders")
    if not isinstance(folders, dict):
        return [{"index": 0, "path": str(root), "label": str(root)}]

    result: list[dict[str, Any]] = []
    for raw_index, fields in folders.items():
        if not str(raw_index).isdigit() or not isinstance(fields, dict):
            continue
        folder_path = str(_ci_get(fields, "path") or "").strip()
        if not folder_path:
            continue
        result.append(
            {
                "index": int(raw_index),
                "path": folder_path,
                "label": folder_path,
            }
        )
    if not result:
        result.append({"index": 0, "path": str(root), "label": str(root)})
    return sorted(result, key=lambda item: item["index"])


def build_game_pool(*, verify: bool = False) -> dict[str, Any]:
    raw = scan_pool()
    if not raw.get("ok"):
        return {**raw, "games": []}

    inventory = verify_all_remembered_accounts(save=True) if verify else load_verified_inventory()
    owner_apps = _verified_owner_apps(inventory)

    # Catalog reach is the union of what seats can see plus verified owned apps.
    # This preserves Family-visible discovery while keeping copy counts separate.
    candidate_ids = {
        int(app_id)
        for account in raw.get("accounts", [])
        for app_id in account.get("accessible_app_ids", [])
        if int(app_id) > 0
    }
    candidate_ids.update(app_id for apps in owner_apps.values() for app_id in apps)

    root = steam_root()
    library_folders = _steam_library_folders(root)
    appinfo_path = root / "appcache" / "appinfo.vdf" if root else Path("__missing__")
    catalog = read_local_app_catalog(appinfo_path, candidate_ids) if appinfo_path.is_file() else {}

    games: dict[int, dict[str, Any]] = {}
    for app_id, item in catalog.items():
        app_type = str(item.get("type") or "").casefold()
        oslist = str(item.get("oslist") or "").casefold()
        name = str(item.get("name") or "").strip()
        if app_type != "game" or not name:
            continue
        if oslist and "windows" not in oslist:
            continue
        games[app_id] = {
            "app_id": app_id,
            "name": name,
            "developer": item.get("developer") or "",
            "publisher": item.get("publisher") or "",
        }

    game_ids = set(games)
    accounts = []
    remembered_user_ids: set[int] = set()
    for account in raw.get("accounts", []):
        user_id = account.get("user_id32")
        if isinstance(user_id, int):
            remembered_user_ids.add(user_id)
        owned = sorted(app_id for app_id in owner_apps.get(user_id, set()) if app_id in game_ids)
        accessible = sorted(
            int(app_id)
            for app_id in account.get("accessible_app_ids", [])
            if int(app_id) in game_ids
        )
        accounts.append(
            {
                "label": account.get("display_name") or account.get("account_name") or "Steam",
                "account_name": account.get("account_name") or "",
                "steam_id64": account.get("steam_id64") or "",
                "user_id32": user_id,
                "app_ids": owned,
                "accessible_app_ids": accessible,
                "ownership_source": "steam-console-licenses-print" if inventory else "unverified",
                "ownership_verified_at": inventory.get("verified_at") if inventory else None,
                "inventory_complete": bool(inventory and inventory.get("complete")),
                "active": bool(account.get("active")),
            }
        )

    # Do not silently turn an unknown Family donor into a usable ProviderAccount.
    # Report it so the admin can add/remember that account explicitly.
    unmapped_owner_ids = sorted(owner for owner in owner_apps if owner not in remembered_user_ids)

    licenses: dict[int, list[str]] = {}
    for account in accounts:
        for app_id in account["app_ids"]:
            licenses.setdefault(app_id, []).append(account["label"])

    verification_errors = list(inventory.get("errors", [])) if inventory else []
    return {
        "ok": True,
        "source": "steam-console-licenses-print" if inventory else "unverified",
        "verification_complete": bool(inventory and inventory.get("complete")),
        "verified_at": inventory.get("verified_at") if inventory else None,
        "verification_errors": verification_errors,
        "unmapped_owner_ids": unmapped_owner_ids,
        "accounts": accounts,
        "games": [games[app_id] for app_id in sorted(games)],
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "library_folders": library_folders,
        "library_folder_count": len(library_folders),
        "account_count": len(accounts),
        "game_count": len(games),
        "license_mapping_count": sum(len(labels) for labels in licenses.values()),
        "duplicate_game_count": sum(1 for labels in licenses.values() if len(labels) > 1),
        "candidate_app_count": len(candidate_ids),
        "owned_unique_app_count": len(licenses),
        "accessible_app_count": int(raw.get("accessible_app_count") or len(candidate_ids)),
        "ownership_error": None if inventory else "No verified Steam licenses_print snapshot exists yet",
    }


def sync_backend(pool: dict[str, Any], api: str = "http://127.0.0.1:8000") -> dict[str, Any]:
    response = requests.post(
        f"{api.rstrip('/')}/admin/pool/sync",
        json={
            "source": pool.get("source", "unverified"),
            "verification_complete": bool(pool.get("verification_complete")),
            "verified_at": pool.get("verified_at"),
            "verification_errors": pool.get("verification_errors", []),
            "accounts": pool.get("accounts", []),
            "games": pool.get("games", []),
        },
        timeout=45,
    )
    response.raise_for_status()
    return response.json()


def main() -> int:
    parser = argparse.ArgumentParser(description="Build/sync the local Steam license pool")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--verify", action="store_true", help="switch through remembered Steam accounts and refresh verified licenses first")
    parser.add_argument("--allow-partial", action="store_true", help="allow backend sync from an incomplete verified snapshot")
    args = parser.parse_args()

    pool = build_game_pool(verify=args.verify)
    if not pool.get("ok"):
        print(json.dumps(pool, ensure_ascii=False))
        return 1
    if not pool.get("verification_complete") and not args.dry_run and not args.allow_partial:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "Verified license inventory is incomplete; backend was not changed",
                    "pool": pool,
                },
                ensure_ascii=False,
            )
        )
        return 2

    result: dict[str, Any] = {"pool": pool}
    if not args.dry_run:
        result["backend"] = sync_backend(pool, args.api)
    if args.compact:
        result = {
            "pool": {
                "source": pool.get("source"),
                "verification_complete": pool.get("verification_complete"),
                "verified_at": pool.get("verified_at"),
                "account_count": pool.get("account_count"),
                "game_count": pool.get("game_count"),
                "license_mapping_count": pool.get("license_mapping_count"),
                "owned_unique_app_count": pool.get("owned_unique_app_count"),
                "accessible_app_count": pool.get("accessible_app_count"),
                "duplicate_game_count": pool.get("duplicate_game_count"),
                "verification_errors": pool.get("verification_errors"),
                "unmapped_owner_ids": pool.get("unmapped_owner_ids"),
                "library_folders": pool.get("library_folders", []),
                "accounts": [
                    {
                        "label": a["label"],
                        "owned_game_count": len(a["app_ids"]),
                        "accessible_game_count": len(a.get("accessible_app_ids") or []),
                        "ownership_source": a.get("ownership_source"),
                        "active": a.get("active", False),
                    }
                    for a in pool.get("accounts", [])
                ],
            },
            **({"backend": result["backend"]} if "backend" in result else {}),
        }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
