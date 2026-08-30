"""Fetch an owner-attributed Steam catalog for every remembered local account."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from steam_pool import remembered_account_identities

ENDPOINT = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / ".gameaccess" / "web_owned_games.json"


def fetch_owned_games(api_key: str, steam_id64: str, *, session: Any = requests) -> list[dict[str, Any]]:
    response = session.get(
        ENDPOINT,
        params={
            "key": api_key,
            "steamid": steam_id64,
            "include_appinfo": 1,
            "include_played_free_games": 1,
            "format": "json",
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json().get("response", {})
    return [game for game in payload.get("games", []) if int(game.get("appid", 0)) > 0]


def build_web_inventory(api_key: str, *, session: Any = requests) -> dict[str, Any]:
    accounts: list[dict[str, Any]] = []
    owners: dict[str, list[str]] = {}
    games: dict[str, dict[str, Any]] = {}
    errors: list[dict[str, str]] = []

    for identity in remembered_account_identities():
        steam_id64 = identity["steam_id64"]
        label = identity.get("display_name") or identity.get("account_name") or steam_id64
        try:
            owned = fetch_owned_games(api_key, steam_id64, session=session)
        except Exception as exc:
            errors.append({"steam_id64": steam_id64, "label": label, "error": str(exc)})
            owned = []

        app_ids: list[int] = []
        for game in owned:
            app_id = int(game["appid"])
            app_ids.append(app_id)
            key = str(app_id)
            owners.setdefault(key, []).append(steam_id64)
            games.setdefault(key, {
                "app_id": app_id,
                "name": str(game.get("name") or f"Steam App {app_id}"),
                "img_icon_url": str(game.get("img_icon_url") or ""),
            })
        accounts.append({**identity, "label": label, "app_ids": sorted(app_ids)})

    return {
        "source": "IPlayerService/GetOwnedGames",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "complete": not errors,
        "accounts": accounts,
        "games": [games[key] for key in sorted(games, key=int)],
        "owners": {key: owners[key] for key in sorted(owners, key=int)},
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch owned games for all remembered Steam accounts")
    parser.add_argument("--key", default=os.environ.get("STEAM_WEB_API_KEY", ""))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    if not args.key:
        parser.error("Steam Web API key required via --key or STEAM_WEB_API_KEY")

    inventory = build_web_inventory(args.key)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(inventory, ensure_ascii=False, indent=None if args.compact else 2))
    return 0 if inventory["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
