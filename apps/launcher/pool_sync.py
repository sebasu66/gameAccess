"""Build and synchronize the GameAccess Steam provider pool.

Catalog reach and ownership are deliberately separate. Catalog reach comes from
cached local Steam metadata. Ownership comes from SteamKit LicenseList + PICS.
A failed provider scan must not block verified ownership updates for the other
providers, and it must not make the failed provider look available.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from provider_inventory import build_provider_catalog
from provider_license_scan import (
    DEFAULT_DIAGNOSTIC_OUTPUT,
    DEFAULT_OUTPUT as LICENSE_OUTPUT,
    load_provider_license_inventory,
    persist_scan_result,
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


def _account_rows(inventory: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not inventory:
        return result
    for account in inventory.get("accounts", []):
        if not isinstance(account, dict):
            continue
        provider_id = str(account.get("provider_id") or "").strip()
        if provider_id:
            result[provider_id] = account
    return result


def _scan_rows(inventory: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not inventory:
        return result
    for scan in inventory.get("scans", []):
        if not isinstance(scan, dict):
            continue
        provider_id = str(scan.get("provider_id") or "").strip()
        if provider_id:
            result[provider_id] = scan
    return result


def _error_rows(inventory: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if not inventory:
        return result
    for error in inventory.get("errors", []):
        if not isinstance(error, dict):
            continue
        provider_id = str(error.get("provider_id") or "").strip()
        if provider_id:
            result[provider_id] = error
    return result


def _owned_ids(account: dict[str, Any] | None) -> set[int]:
    if not account:
        return set()
    return {
        int(app_id)
        for app_id in account.get("owned_app_ids") or []
        if str(app_id).isdigit() and int(app_id) > 0
    }


def _inventory_time(inventory: dict[str, Any] | None) -> datetime:
    raw = str((inventory or {}).get("verified_at") or "").strip()
    if not raw:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def _ownership_state_by_provider() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Return best known per-provider ownership plus latest scan diagnostics.

    A complete authoritative snapshot is the fallback. A newer diagnostic scan
    can independently verify providers that succeeded while leaving failed
    providers on the fallback (if one exists) or unverified.
    """
    authoritative = load_provider_license_inventory(LICENSE_OUTPUT, require_complete=True)
    diagnostic = load_provider_license_inventory(DEFAULT_DIAGNOSTIC_OUTPUT)

    state: dict[str, dict[str, Any]] = {}
    if authoritative:
        for provider_id, account in _account_rows(authoritative).items():
            state[provider_id] = {
                "owned_app_ids": _owned_ids(account),
                "inventory_complete": True,
                "ownership_source": authoritative.get("source") or "steamkit-license-list-pics",
                "ownership_verified_at": authoritative.get("verified_at"),
                "scan_status": "ok",
                "scan_error": None,
            }

    # Diagnostic snapshots are useful only when they are newer than the
    # complete authoritative inventory. An old failed batch must never override
    # a later successful full-roster scan.
    diagnostic_is_newer = bool(
        diagnostic
        and (not authoritative or _inventory_time(diagnostic) > _inventory_time(authoritative))
    )
    latest = diagnostic if diagnostic_is_newer else authoritative
    if diagnostic_is_newer and diagnostic:
        accounts = _account_rows(diagnostic)
        scans = _scan_rows(diagnostic)
        errors = _error_rows(diagnostic)
        for provider_id, scan in scans.items():
            status = str(scan.get("status") or "unknown")
            scan_complete = bool(status == "ok" and scan.get("complete"))
            error = errors.get(provider_id) or {}
            if scan_complete:
                state[provider_id] = {
                    "owned_app_ids": _owned_ids(accounts.get(provider_id)),
                    "inventory_complete": True,
                    "ownership_source": diagnostic.get("source") or "steamkit-license-list-pics",
                    "ownership_verified_at": diagnostic.get("verified_at"),
                    "scan_status": "ok",
                    "scan_error": None,
                }
            else:
                previous = state.get(provider_id, {})
                state[provider_id] = {
                    "owned_app_ids": set(previous.get("owned_app_ids") or []),
                    "inventory_complete": bool(previous.get("inventory_complete")),
                    "ownership_source": previous.get("ownership_source") or "unverified",
                    "ownership_verified_at": previous.get("ownership_verified_at"),
                    "scan_status": status,
                    "scan_error": str(error.get("error") or status)[:500],
                }

    metadata = {
        "source": (latest or {}).get("source") or "unverified",
        "verified_at": (latest or {}).get("verified_at"),
        "verification_errors": list((latest or {}).get("errors") or []),
        "latest_inventory_complete": bool(latest and latest.get("complete")),
    }
    return state, metadata


def build_game_pool(*, refresh_licenses: bool = False) -> dict[str, Any]:
    catalog = build_provider_catalog()
    if not catalog.get("accounts"):
        return {**catalog, "ok": False, "games": [], "accounts": []}

    if refresh_licenses:
        refreshed = scan_provider_licenses(provider_ids=None)
        persist_scan_result(refreshed)

    ownership_state, ownership_meta = _ownership_state_by_provider()
    games = list(catalog.get("games") or [])
    game_ids = {int(game["app_id"]) for game in games}

    accounts: list[dict[str, Any]] = []
    for account in catalog.get("accounts", []):
        provider_id = str(account.get("provider_id") or "")
        state = ownership_state.get(provider_id, {})
        owned = sorted(
            app_id for app_id in set(state.get("owned_app_ids") or []) if app_id in game_ids
        )
        accessible = sorted(
            int(app_id)
            for app_id in account.get("accessible_app_ids") or []
            if int(app_id) in game_ids
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

    verified_account_count = sum(1 for account in accounts if account["inventory_complete"])
    verification_complete = bool(accounts) and verified_account_count == len(accounts)
    root = steam_root()
    library_folders = _steam_library_folders(root)

    return {
        "ok": bool(catalog.get("ok")),
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
        "ownership_error": None if verification_complete else "Some Steam providers are currently unverified or unavailable",
    }


def sync_backend(pool: dict[str, Any], api: str = "http://127.0.0.1:38147") -> dict[str, Any]:
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
    parser.add_argument("--refresh-licenses", action="store_true", help="headlessly rescan all provider licenses with SteamKit first")
    parser.add_argument("--require-verified", action="store_true", help="refuse backend sync unless every provider has verified SteamKit ownership")
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
