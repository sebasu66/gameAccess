from __future__ import annotations

import argparse
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from app import main as core
from app.catalog_metadata import ensure_catalog_schema, seed_known_games

API_URL = "https://www.pcgamingwiki.com/w/api.php"
USER_ENV = "GAMEACCESS_PCGW_BOT_USER"
PASSWORD_ENV = "GAMEACCESS_PCGW_BOT_PASSWORD"
USER_AGENT = "GameAccess/0.1 catalog metadata importer"


def _login(client: httpx.Client, username: str, password: str) -> None:
    token_response = client.get(
        API_URL,
        params={"action": "query", "meta": "tokens", "type": "login", "format": "json"},
    )
    token_response.raise_for_status()
    token = token_response.json()["query"]["tokens"]["logintoken"]
    response = client.post(
        API_URL,
        data={
            "action": "login",
            "lgname": username,
            "lgpassword": password,
            "lgtoken": token,
            "format": "json",
        },
    )
    response.raise_for_status()
    result = response.json().get("login", {}).get("result")
    if result != "Success":
        raise RuntimeError(f"PCGamingWiki login failed: {result or 'unknown result'}")


def _app_ids(value: object) -> list[int]:
    return sorted({int(match) for match in re.findall(r"\d+", str(value or "")) if int(match) > 0})


def _rows(client: httpx.Client, limit: int = 500):
    offset = 0
    while True:
        response = client.get(
            API_URL,
            params={
                "action": "cargoquery",
                "tables": "Game,GameData",
                "fields": (
                    "Game._pageName=Page,"
                    "Game.Steam_AppID=AppIDs,"
                    "GameData.Type=Type,"
                    "GameData.Platform=Platform,"
                    "GameData.Paths=Paths"
                ),
                "join_on": "Game._pageID=GameData._pageID",
                "limit": str(limit),
                "offset": str(offset),
                "format": "json",
            },
        )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("cargoquery") or []
        if not rows:
            return
        for row in rows:
            title = row.get("title") if isinstance(row, dict) else None
            if isinstance(title, dict):
                yield title
        if len(rows) < limit:
            return
        offset += len(rows)
        time.sleep(1.05)


def sync(username: str, password: str) -> dict[str, int]:
    ensure_catalog_schema(core.engine)
    seed_known_games(core.engine)
    with core.engine.begin() as conn:
        games = {
            int(row[0]): int(row[1])
            for row in conn.exec_driver_sql(
                "SELECT app_id, id FROM game WHERE app_id IS NOT NULL"
            ).all()
        }

    matched_games: set[int] = set()
    inserted = 0
    ignored = 0
    now = datetime.now(timezone.utc).isoformat()
    with httpx.Client(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        _login(client, username, password)
        with core.engine.begin() as conn:
            for row in _rows(client):
                app_ids = _app_ids(row.get("AppIDs"))
                data_type = str(row.get("Type") or "").strip().casefold()
                platform = str(row.get("Platform") or "").strip() or "Unknown"
                path = str(row.get("Paths") or "").strip()
                page = str(row.get("Page") or "").strip()
                if not data_type or not path:
                    continue
                for app_id in app_ids:
                    game_id = games.get(app_id)
                    if not game_id:
                        ignored += 1
                        continue
                    conn.exec_driver_sql(
                        """
                        INSERT OR IGNORE INTO game_data_path(
                            game_id, data_type, platform, path, source, source_url, updated_at
                        ) VALUES (?, ?, ?, ?, 'pcgamingwiki', ?, ?)
                        """,
                        (
                            game_id,
                            data_type,
                            platform,
                            path,
                            f"https://www.pcgamingwiki.com/wiki/{quote(page.replace(' ', '_'))}" if page else None,
                            now,
                        ),
                    )
                    inserted += 1
                    matched_games.add(game_id)
    return {
        "known_games": len(games),
        "matched_games": len(matched_games),
        "path_rows_processed": inserted,
        "rows_ignored_not_in_catalog": ignored,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Import PCGamingWiki save/config paths into GameAccess")
    parser.add_argument("--user", default=os.environ.get(USER_ENV, ""))
    parser.add_argument("--password", default=os.environ.get(PASSWORD_ENV, ""))
    args = parser.parse_args()
    if not args.user or not args.password:
        raise SystemExit(
            f"PCGamingWiki bot credentials required via {USER_ENV} and {PASSWORD_ENV}"
        )
    print(sync(args.user, args.password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
