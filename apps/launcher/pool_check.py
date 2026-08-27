"""Small diagnostic for true Steam license ownership vs Family accessibility."""

from __future__ import annotations

import argparse
import json

import requests

from pool_sync import build_game_pool


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--api", default=None, help="Optional backend URL to verify synced copies_total")
    args = parser.parse_args()

    pool = build_game_pool()
    if not pool.get("ok"):
        print(json.dumps({"ok": False, "error": pool.get("message")}, ensure_ascii=False))
        return 1

    game = next((item for item in pool.get("games", []) if int(item.get("app_id") or 0) == args.app_id), None)
    owners = [
        account["label"]
        for account in pool.get("accounts", [])
        if args.app_id in set(account.get("app_ids") or [])
    ]
    accessible = [
        account["label"]
        for account in pool.get("accounts", [])
        if args.app_id in set(account.get("accessible_app_ids") or [])
    ]

    result = {
        "ok": True,
        "app_id": args.app_id,
        "name": game.get("name") if game else None,
        "owned_copies": len(owners),
        "owners": owners,
        "accessible_seats": len(accessible),
        "accessible_accounts": accessible,
        "ownership_source": "steam-local-license-packages",
        "unresolved_package_count": pool.get("unresolved_package_count", 0),
        "ownership_error": pool.get("ownership_error"),
    }

    if args.api:
        try:
            response = requests.get(f"{args.api.rstrip('/')}/catalog", timeout=15)
            response.raise_for_status()
            catalog = response.json()
            backend = next(
                (item for item in catalog if int(item.get("app_id") or 0) == args.app_id),
                None,
            )
            result["backend"] = (
                {
                    "copies_total": backend.get("copies_total"),
                    "copies_available": backend.get("copies_available"),
                }
                if backend
                else None
            )
        except Exception as exc:
            result["backend_error"] = str(exc)

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
