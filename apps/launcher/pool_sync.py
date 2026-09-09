"""Build and synchronize the GameAccess Steam provider pool.

Catalog membership comes only from verified provider ownership. Cached local
Steam metadata is useful for discovering names and current accessibility, but
it must never make a locally/family-visible game part of the GameAccess catalog.
A failed provider scan must not block verified ownership updates for the other
providers, and it must not make the failed provider look available.
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from provider_inventory import build_provider_catalog
from provider_license_scan import persist_scan_result, scan_provider_licenses
from provider_ownership_store import ProviderOwnershipStore
from steam_pool import _ci_get, _read_vdf, steam_root


def _library_space(path: Path) -> tuple[int | None, int | None]:
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return None, None
    return int(usage.free), int(usage.total)


def _library_row(index: int, folder_path: str) -> dict[str, Any]:
    free_bytes, total_bytes = _library_space(Path(folder_path))
    return {
        "index": index,
        "path": folder_path,
        "label": folder_path,
        "free_bytes": free_bytes,
        "total_bytes": total_bytes,
    }


def _steam_library_folders(root: Path | None) -> list[dict[str, Any]]:
    if not root:
        return []

    # Current Steam clients keep libraryfolders.vdf under config/. Older
    # installations/tools may still expose the steamapps/ copy, so keep it as
    # an explicit fallback without renumbering Steam's volume indices.
    folders: dict[str, Any] | None = None
    for path in (
        root / "config" / "libraryfolders.vdf",
        root / "steamapps" / "libraryfolders.vdf",
    ):
        try:
            parsed = _read_vdf(path)
        except (OSError, ValueError):
            continue
        candidate = _ci_get(parsed, "libraryfolders")
        if isinstance(candidate, dict):
            folders = candidate
            break

    if folders is None:
        return [_library_row(0, str(root))]

    result: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for raw_index, fields in folders.items():
        if not str(raw_index).isdigit() or not isinstance(fields, dict):
            continue
        folder_path = str(_ci_get(fields, "path") or "").strip()
        if not folder_path:
            continue
        dedupe_key = folder_path.rstrip("\\/").casefold()
        if dedupe_key in seen_paths:
            continue
        seen_paths.add(dedupe_key)
        result.append(_library_row(int(raw_index), folder_path))

    if not result:
        result.append(_library_row(0, str(root)))
    return sorted(result, key=lambda item: item["index"])


def _ownership_state_by_provider() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    # Read durable per-provider ownership and latest scan health.
    state = ProviderOwnershipStore().states()
    verified_at = max(
        (
            str(row.get("ownership_verified_at") or "")
            for row in state.values()
            if row.get("ownership_verified_at")
        ),
        default="",
    ) or None
    errors = [
        {
            "provider_id": provider_id,
            "status": row.get("scan_status"),
            "error": row.get("scan_error") or row.get("scan_status"),
        }
        for provider_id, row in state.items()
        if str(row.get("scan_status") or "") not in {"", "ok", "not_scanned", "unknown"}
    ]
    return state, {
        "source": "per-provider-steamkit-ownership",
        "verified_at": verified_at,
        "verification_errors": errors,
        "latest_inventory_complete": bool(state)
        and all(bool(row.get("inventory_complete")) for row in state.values()),
    }


def build_game_pool(*, refresh_licenses: bool = False) -> dict[str, Any]:
    if refresh_licenses:
        refreshed = scan_provider_licenses(provider_ids=None)
        ProviderOwnershipStore().record_scan(refreshed)
        persist_scan_result(refreshed)

    ownership_state, ownership_meta = _ownership_state_by_provider()
    verified_owned_app_ids = {
        int(app_id)
        for state in ownership_state.values()
        if state.get("inventory_complete")
        for app_id in state.get("owned_app_ids") or set()
        if str(app_id).isdigit() and int(app_id) > 0
    }

    # Verified SteamKit ownership broadens the metadata candidate set. Local
    # visibility remains accessibility evidence only and cannot erase a license.
    catalog = build_provider_catalog(additional_candidate_ids=verified_owned_app_ids)
    if not catalog.get("accounts"):
        return {**catalog, "ok": False, "games": [], "accounts": []}

    candidate_games = list(catalog.get("games") or [])
    candidate_game_ids = {int(game["app_id"]) for game in candidate_games}

    accounts: list[dict[str, Any]] = []
    for account in catalog.get("accounts", []):
        provider_id = str(account.get("provider_id") or "")
        state = ownership_state.get(provider_id, {})
        owned = sorted(
            app_id for app_id in set(state.get("owned_app_ids") or []) if app_id in candidate_game_ids
        )
        accessible = sorted(
            int(app_id)
            for app_id in account.get("accessible_app_ids") or []
            if int(app_id) in candidate_game_ids
        )
        accounts.append(
            {
                "provider_id": provider_id,
                "label": account.get("label") or provider_id,
                "account_name": account.get("account_name") or "",
                "steam_id64": account.get("steam_id64") or "",
                "user_id32": account.get("user_id32"),
                "app_ids": owned,
                "accessible_app_ids": accessible,
                "ownership_source": state.get("ownership_source") or "unverified",
                "ownership_verified_at": state.get("ownership_verified_at"),
                "inventory_complete": bool(state.get("inventory_complete")),
                "scan_status": state.get("scan_status") or "not_scanned",
                "scan_error": state.get("scan_error"),
                "active": False,
            }
        )

    licenses: dict[int, list[str]] = {}
    for account in accounts:
        for app_id in account["app_ids"]:
            licenses.setdefault(app_id, []).append(account["provider_id"])

    # Critical boundary: accessibility/install state never grants GameAccess
    # catalog membership. Only AppIDs owned by at least one verified provider
    # are published to the backend catalog.
    licensed_app_ids = set(licenses)
    games = [
        game for game in candidate_games
        if int(game.get("app_id") or 0) in licensed_app_ids
    ]

    verified_account_count = sum(1 for account in accounts if account["inventory_complete"])
    verification_complete = bool(accounts) and verified_account_count == len(accounts)
    root = steam_root()
    library_folders = _steam_library_folders(root)

    return {
        "ok": bool(accounts and games),
        "catalog_ok": bool(catalog.get("ok")),
        "source": ownership_meta["source"],
        "catalog_source": catalog.get("source"),
        "verification_complete": verification_complete,
        "verified_at": ownership_meta["verified_at"],
        "verification_errors": ownership_meta["verification_errors"],
        "verified_account_count": verified_account_count,
        "unverified_account_count": len(accounts) - verified_account_count,
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
        "ownership_error": None
        if verification_complete
        else "Some Steam providers are currently unverified or unavailable",
    }


def sync_backend(pool: dict[str, Any], api: str = "http://127.0.0.1:38147") -> dict[str, Any]:
    import requests

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
        "verified_account_count": pool.get("verified_account_count"),
        "unverified_account_count": pool.get("unverified_account_count"),
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
                "inventory_complete": account.get("inventory_complete"),
                "scan_status": account.get("scan_status"),
                "scan_error": account.get("scan_error"),
            }
            for account in pool.get("accounts", [])
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build/sync the GameAccess Steam provider pool")
    parser.add_argument("--api", default="http://127.0.0.1:38147")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument(
        "--refresh-licenses",
        action="store_true",
        help="headlessly rescan all provider licenses with SteamKit first",
    )
    parser.add_argument(
        "--require-verified",
        action="store_true",
        help="refuse backend sync unless every provider has verified SteamKit ownership",
    )
    args = parser.parse_args()

    pool = build_game_pool(refresh_licenses=args.refresh_licenses)
    if not pool.get("ok"):
        print(json.dumps({"ok": False, "pool": compact_pool(pool)}, ensure_ascii=False))
        return 1
    if args.require_verified and not pool.get("verification_complete"):
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "SteamKit ownership inventory is incomplete",
                    "pool": compact_pool(pool),
                },
                ensure_ascii=False,
            )
        )
        return 2

    result: dict[str, Any] = {"pool": compact_pool(pool) if args.compact else pool}
    if not args.dry_run:
        result["backend"] = sync_backend(pool, args.api)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
