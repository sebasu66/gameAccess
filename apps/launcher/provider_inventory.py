"""Build the GameAccess provider catalog from local Steam metadata.

This scanner is login-free: it maps the provider roster from ``cuentas.txt`` to
local Steam identities and reads each identity's cached library metadata.  The
result answers *which games a provider seat can currently see/use*.  It does
not claim ownership; authoritative copies are supplied separately by the
SteamKit license scanner.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from provider_roster import match_provider_identities
from steam_appinfo import read_local_app_catalog
from steam_pool import local_library_apps, steam_root


def build_provider_catalog() -> dict[str, Any]:
    mapping = match_provider_identities()
    accounts: list[dict[str, Any]] = []
    candidate_ids: set[int] = set()
    nonempty_accounts = 0

    for identity in mapping.get("accounts", []):
        user_id32 = identity.get("user_id32")
        accessible_ids: list[int] = []
        if identity.get("matched") and isinstance(user_id32, int):
            accessible_ids = sorted(local_library_apps(user_id32))
            if accessible_ids:
                nonempty_accounts += 1
            candidate_ids.update(accessible_ids)
        accounts.append(
            {
                "provider_id": identity["provider_id"],
                # These two fields are required only for the local backend sync.
                # Compact CLI output deliberately omits them.
                "label": identity.get("label") or "",
                "account_name": identity.get("account_name") or "",
                "steam_id64": identity.get("steam_id64") or "",
                "user_id32": user_id32,
                "remembered": bool(identity.get("remembered")),
                "matched": bool(identity.get("matched")),
                "accessible_app_ids": accessible_ids,
            }
        )

    root = steam_root()
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
        games[int(app_id)] = {
            "app_id": int(app_id),
            "name": name,
            "developer": item.get("developer") or "",
            "publisher": item.get("publisher") or "",
        }

    game_ids = set(games)
    for account in accounts:
        account["accessible_app_ids"] = [
            app_id for app_id in account["accessible_app_ids"] if app_id in game_ids
        ]

    return {
        "ok": bool(accounts) and mapping.get("missing_identity_count") == 0,
        "source": "steam-local-provider-library-cache",
        "roster_count": int(mapping.get("roster_count") or 0),
        "matched_identity_count": int(mapping.get("matched_identity_count") or 0),
        "missing_identity_count": int(mapping.get("missing_identity_count") or 0),
        "missing_provider_ids": list(mapping.get("missing_provider_ids") or []),
        "local_library_nonempty_accounts": nonempty_accounts,
        "all_provider_remember_false": all(not account["remembered"] for account in accounts),
        "candidate_app_count": len(candidate_ids),
        "accessible_unique_app_count": len(game_ids),
        "account_count": len(accounts),
        "game_count": len(games),
        "accounts": accounts,
        "games": [games[app_id] for app_id in sorted(games)],
    }


def compact_catalog(catalog: dict[str, Any]) -> dict[str, Any]:
    return {
        key: catalog.get(key)
        for key in (
            "ok",
            "source",
            "roster_count",
            "matched_identity_count",
            "missing_identity_count",
            "missing_provider_ids",
            "local_library_nonempty_accounts",
            "all_provider_remember_false",
            "candidate_app_count",
            "accessible_unique_app_count",
            "account_count",
            "game_count",
        )
    } | {
        "accounts": [
            {
                "provider_id": account["provider_id"],
                "matched": account["matched"],
                "remembered": account["remembered"],
                "accessible_game_count": len(account["accessible_app_ids"]),
            }
            for account in catalog.get("accounts", [])
        ]
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan the GameAccess provider catalog without logging into Steam")
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    catalog = build_provider_catalog()
    output = compact_catalog(catalog) if args.compact else catalog
    print(json.dumps(output, ensure_ascii=False))
    return 0 if catalog.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
