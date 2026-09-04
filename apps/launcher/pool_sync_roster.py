from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from account_roster import load_gameaccess_accounts
from pool_sync import build_game_pool, sync_backend


def build_roster_pool(accounts_file: str | Path) -> dict[str, Any]:
    roster = load_gameaccess_accounts(accounts_file)
    roster_names = {item.account_name.strip().casefold() for item in roster}

    base = build_game_pool(verify=False)
    if not base.get("ok"):
        return {**base, "roster_account_count": len(roster)}

    selected_accounts = [
        account
        for account in base.get("accounts", [])
        if str(account.get("account_name") or "").strip().casefold() in roster_names
    ]
    matched_names = {
        str(account.get("account_name") or "").strip().casefold()
        for account in selected_accounts
    }
    missing_names = roster_names - matched_names

    candidate_ids: set[int] = set()
    licenses: dict[int, list[str]] = {}
    for account in selected_accounts:
        label = str(account.get("label") or account.get("account_name") or "Steam")
        for app_id in account.get("accessible_app_ids") or []:
            candidate_ids.add(int(app_id))
        for app_id in account.get("app_ids") or []:
            app = int(app_id)
            candidate_ids.add(app)
            licenses.setdefault(app, []).append(label)

    games = [
        game
        for game in base.get("games", [])
        if int(game.get("app_id") or 0) in candidate_ids
    ]

    complete = bool(base.get("verification_complete")) and not missing_names
    return {
        **base,
        "verification_complete": complete,
        "accounts": selected_accounts,
        "games": games,
        "licenses": {str(app_id): labels for app_id, labels in sorted(licenses.items())},
        "account_count": len(selected_accounts),
        "game_count": len(games),
        "license_mapping_count": sum(len(labels) for labels in licenses.values()),
        "owned_unique_app_count": len(licenses),
        "duplicate_game_count": sum(1 for labels in licenses.values() if len(labels) > 1),
        "roster_account_count": len(roster),
        "roster_unique_account_count": len(roster_names),
        "roster_matched_local_count": len(matched_names),
        "roster_missing_local_count": len(missing_names),
    }


def compact(pool: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": pool.get("ok"),
        "source": pool.get("source"),
        "verification_complete": pool.get("verification_complete"),
        "roster_account_count": pool.get("roster_account_count"),
        "roster_unique_account_count": pool.get("roster_unique_account_count"),
        "roster_matched_local_count": pool.get("roster_matched_local_count"),
        "roster_missing_local_count": pool.get("roster_missing_local_count"),
        "account_count": pool.get("account_count"),
        "game_count": pool.get("game_count"),
        "owned_unique_app_count": pool.get("owned_unique_app_count"),
        "license_mapping_count": pool.get("license_mapping_count"),
        "duplicate_game_count": pool.get("duplicate_game_count"),
        "accounts": [
            {
                "label": a.get("label"),
                "owned_game_count": len(a.get("app_ids") or []),
                "accessible_game_count": len(a.get("accessible_app_ids") or []),
                "remember_password": a.get("remember_password"),
                "is_personal": a.get("is_personal"),
            }
            for a in pool.get("accounts", [])
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Game Access pool from explicit cuentas.txt roster")
    parser.add_argument("--accounts-file", required=True)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()

    pool = build_roster_pool(args.accounts_file)
    result: dict[str, Any] = {"pool": compact(pool) if args.compact else pool}
    if not args.dry_run:
        if not pool.get("verification_complete"):
            result["backend"] = {"ok": False, "error": "Roster inventory is incomplete; backend was not changed"}
            print(json.dumps(result, ensure_ascii=False))
            return 2
        result["backend"] = sync_backend(pool, args.api)

    print(json.dumps(result, ensure_ascii=False))
    return 0 if pool.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
