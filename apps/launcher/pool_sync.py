"""Build and synchronize the local Steam game/license pool for gameAccess.

Catalog visibility and license ownership are intentionally separate:
- accessible_app_ids may include Steam Family shared games and are useful to
  discover the catalog/seat reach;
- app_ids are true owned apps resolved from local Steam license packages.
Only app_ids create backend AccountGame/license mappings.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import requests

from steam_appinfo import read_local_app_catalog
from steam_pool import scan_pool, steam_root


def build_game_pool() -> dict[str, Any]:
    raw = scan_pool()
    if not raw.get("ok"):
        return {**raw, "games": []}

    # Use every accessible app only to discover names/catalog entries. Ownership
    # is decided later from account.app_ids (resolved license packages).
    candidate_ids = {
        int(app_id)
        for account in raw.get("accounts", [])
        for app_id in (account.get("accessible_app_ids") or account.get("app_ids") or [])
    }
    candidate_ids.update(
        int(app_id)
        for account in raw.get("accounts", [])
        for app_id in account.get("app_ids", [])
    )

    root = steam_root()
    appinfo_path = root / "appcache" / "appinfo.vdf" if root else Path("__missing__")
    catalog = read_local_app_catalog(appinfo_path, candidate_ids) if appinfo_path.is_file() else {}

    # Only top-level Windows games belong in the consumer gameAccess catalog.
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
    for account in raw.get("accounts", []):
        owned = sorted(int(app_id) for app_id in account.get("app_ids", []) if int(app_id) in game_ids)
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
                "user_id32": account.get("user_id32"),
                # Backend AccountGame rows are created ONLY from this field.
                "app_ids": owned,
                "accessible_app_ids": accessible,
                "license_package_count": int(account.get("license_package_count") or 0),
                "unresolved_package_count": int(account.get("unresolved_package_count") or 0),
                "ownership_source": account.get("ownership_source") or raw.get("ownership_source") or "unknown",
                "active": bool(account.get("active")),
            }
        )

    licenses: dict[int, list[str]] = {}
    for account in accounts:
        for app_id in account["app_ids"]:
            licenses.setdefault(app_id, []).append(account["label"])

    return {
        "ok": True,
        "source": "steam-local-license-packages",
        "accounts": accounts,
        "games": [games[app_id] for app_id in sorted(games)],
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "account_count": len(accounts),
        "game_count": len(games),
        "duplicate_game_count": sum(1 for labels in licenses.values() if len(labels) > 1),
        "candidate_app_count": len(candidate_ids),
        "owned_unique_app_count": len(licenses),
        "accessible_app_count": int(raw.get("accessible_app_count") or len(candidate_ids)),
        "license_package_count": int(raw.get("license_package_count") or 0),
        "unresolved_package_count": int(raw.get("unresolved_package_count") or 0),
        "ownership_error": raw.get("ownership_error"),
    }


def sync_backend(pool: dict[str, Any], api: str = "http://127.0.0.1:8000") -> dict[str, Any]:
    response = requests.post(
        f"{api.rstrip('/')}/admin/pool/sync",
        json={
            "source": pool.get("source", "steam-local-license-packages"),
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
    args = parser.parse_args()

    pool = build_game_pool()
    if not pool.get("ok"):
        print(json.dumps(pool, ensure_ascii=False))
        return 1
    result: dict[str, Any] = {"pool": pool}
    if not args.dry_run:
        result["backend"] = sync_backend(pool, args.api)
    if args.compact:
        result = {
            "pool": {
                "account_count": pool.get("account_count"),
                "game_count": pool.get("game_count"),
                "owned_unique_app_count": pool.get("owned_unique_app_count"),
                "accessible_app_count": pool.get("accessible_app_count"),
                "duplicate_game_count": pool.get("duplicate_game_count"),
                "candidate_app_count": pool.get("candidate_app_count"),
                "license_package_count": pool.get("license_package_count"),
                "unresolved_package_count": pool.get("unresolved_package_count"),
                "ownership_error": pool.get("ownership_error"),
                "accounts": [
                    {
                        "label": a["label"],
                        "owned_game_count": len(a["app_ids"]),
                        "accessible_game_count": len(a.get("accessible_app_ids") or []),
                        "license_package_count": a.get("license_package_count", 0),
                        "unresolved_package_count": a.get("unresolved_package_count", 0),
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
