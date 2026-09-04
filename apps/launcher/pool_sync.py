"""Build and synchronize the GameAccess Steam provider pool.

Provider catalog reach and license ownership are deliberately separate:

* catalog reach comes from cached local Steam metadata for accounts listed in
  ``cuentas.txt`` and requires no Steam login;
* authoritative copy ownership comes from the optional headless SteamKit
  LicenseList + PICS snapshot.

An incomplete ownership scan may refresh the catalog, but it must never erase a
previous authoritative license mapping in the backend.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import requests

from provider_inventory import build_provider_catalog
from provider_license_scan import (
    DEFAULT_OUTPUT as LICENSE_OUTPUT,
    load_provider_license_inventory,
    save_provider_license_inventory,
    scan_provider_licenses,
)
from steam_pool import _ci_get, _read_vdf, steam_root


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
        if folder_path:
            result.append({"index": int(raw_index), "path": folder_path, "label": folder_path})
    if not result:
        result.append({"index": 0, "path": str(root), "label": str(root)})
    return sorted(result, key=lambda item: item["index"])


def _owned_apps_by_provider(inventory: dict[str, Any] | None) -> dict[str, set[int]]:
    result: dict[str, set[int]] = {}
    if not inventory:
        return result
    for account in inventory.get("accounts", []):
        if not isinstance(account, dict):
            continue
        provider_id = str(account.get("provider_id") or "").strip()
        if not provider_id:
            continue
        result[provider_id] = {
            int(app_id)
            for app_id in account.get("owned_app_ids") or []
            if str(app_id).isdigit() and int(app_id) > 0
        }
    return result


def build_game_pool(*, refresh_licenses: bool = False) -> dict[str, Any]:
    catalog = build_provider_catalog()
    if not catalog.get("accounts"):
        return {**catalog, "ok": False, "games": [], "accounts": []}

    if refresh_licenses:
        refreshed = scan_provider_licenses(provider_ids=None)
        save_provider_license_inventory(refreshed, LICENSE_OUTPUT)

    inventory = load_provider_license_inventory()
    owned_by_provider = _owned_apps_by_provider(inventory)
    games = list(catalog.get("games") or [])
    game_ids = {int(game["app_id"]) for game in games}

    accounts: list[dict[str, Any]] = []
    for account in catalog.get("accounts", []):
        provider_id = str(account.get("provider_id") or "")
        owned = sorted(app_id for app_id in owned_by_provider.get(provider_id, set()) if app_id in game_ids)
        accessible = sorted(
            int(app_id)
            for app_id in account.get("accessible_app_ids") or []
            if int(app_id) in game_ids
        )
        accounts.append(
            {
                "provider_id": provider_id,
                # These identity fields are consumed only by the local backend.
                "label": account.get("label") or provider_id,
                "account_name": account.get("account_name") or "",
                "steam_id64": account.get("steam_id64") or "",
                "user_id32": account.get("user_id32"),
                "app_ids": owned,
                "accessible_app_ids": accessible,
                "ownership_source": inventory.get("source") if inventory else "unverified",
                "ownership_verified_at": inventory.get("verified_at") if inventory else None,
                "inventory_complete": bool(inventory and inventory.get("complete")),
                "active": False,
            }
        )

    licenses: dict[int, list[str]] = {}
    for account in accounts:
        for app_id in account["app_ids"]:
            licenses.setdefault(app_id, []).append(account["provider_id"])

    verification_errors = list(inventory.get("errors") or []) if inventory else []
    verification_complete = bool(inventory and inventory.get("complete"))
    source = str(inventory.get("source")) if inventory else str(catalog.get("source") or "unverified")
    root = steam_root()
    library_folders = _steam_library_folders(root)

    return {
        "ok": bool(catalog.get("ok")),
        "source": source,
        "catalog_source": catalog.get("source"),
        "verification_complete": verification_complete,
        "verified_at": inventory.get("verified_at") if inventory else None,
        "verification_errors": verification_errors,
        "roster_count": catalog.get("roster_count", 0),
        "matched_identity_count": catalog.get("matched_identity_count", 0),
        "missing_identity_count": catalog.get("missing_identity_count", 0),
        "missing_provider_ids": catalog.get("missing_provider_ids", []),
        "all_provider_remember_false": catalog.get("all_provider_remember_false"),
        "accounts": accounts,
        "games": games,
        "licenses": {str(app_id): providers for app_id, providers in sorted(licenses.items())},
        "library_folders": library_folders,
        "library_folder_count": len(library_folders),
        "account_count": len(accounts),
        "game_count": len(games),
        "license_mapping_count": sum(len(providers) for providers in licenses.values()),
        "duplicate_game_count": sum(1 for providers in licenses.values() if len(providers) > 1),
        "candidate_app_count": catalog.get("candidate_app_count", 0),
        "owned_unique_app_count": len(licenses),
        "accessible_app_count": catalog.get("accessible_unique_app_count", 0),
        "ownership_error": None if verification_complete else "Authoritative SteamKit ownership is partial or not scanned yet",
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


def compact_pool(pool: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": pool.get("source"),
        "catalog_source": pool.get("catalog_source"),
        "verification_complete": pool.get("verification_complete"),
        "verified_at": pool.get("verified_at"),
        "roster_count": pool.get("roster_count"),
        "matched_identity_count": pool.get("matched_identity_count"),
        "missing_identity_count": pool.get("missing_identity_count"),
        "missing_provider_ids": pool.get("missing_provider_ids"),
        "all_provider_remember_false": pool.get("all_provider_remember_false"),
        "account_count": pool.get("account_count"),
        "game_count": pool.get("game_count"),
        "license_mapping_count": pool.get("license_mapping_count"),
        "owned_unique_app_count": pool.get("owned_unique_app_count"),
        "accessible_app_count": pool.get("accessible_app_count"),
        "duplicate_game_count": pool.get("duplicate_game_count"),
        "verification_errors": pool.get("verification_errors"),
        "library_folders": pool.get("library_folders", []),
        "accounts": [
            {
                "provider_id": account["provider_id"],
                "owned_game_count": len(account.get("app_ids") or []),
                "accessible_game_count": len(account.get("accessible_app_ids") or []),
                "ownership_source": account.get("ownership_source"),
            }
            for account in pool.get("accounts", [])
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build/sync the GameAccess Steam provider pool")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--refresh-licenses", action="store_true", help="headlessly rescan all provider licenses with SteamKit first")
    parser.add_argument("--require-verified", action="store_true", help="refuse backend sync unless the SteamKit ownership snapshot is complete")
    args = parser.parse_args()

    pool = build_game_pool(refresh_licenses=args.refresh_licenses)
    if not pool.get("ok"):
        print(json.dumps({"ok": False, "pool": compact_pool(pool)}, ensure_ascii=False))
        return 1
    if args.require_verified and not pool.get("verification_complete"):
        print(json.dumps({"ok": False, "error": "SteamKit ownership inventory is incomplete", "pool": compact_pool(pool)}, ensure_ascii=False))
        return 2

    result: dict[str, Any] = {"pool": compact_pool(pool) if args.compact else pool}
    if not args.dry_run:
        result["backend"] = sync_backend(pool, args.api)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
