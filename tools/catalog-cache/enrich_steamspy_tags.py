#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import sqlite3
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = REPO_ROOT / "apps" / "api" / "gameaccess.db"
CACHE_DIR = REPO_ROOT / "apps" / "api" / ".admin_tasks"
CACHE_PATH = CACHE_DIR / "steamspy-tags-cache.json"
BASE_URL = "https://steamspy.com/api.php"


def load_targets(con: sqlite3.Connection) -> dict[int, int]:
    rows = con.execute(
        """
        SELECT DISTINCT g.app_id, g.id
        FROM game g
        JOIN game_metadata m ON m.game_id=g.id
        WHERE g.active=1
          AND g.app_id IS NOT NULL
          AND lower(coalesce(m.product_type,''))='game'
          AND EXISTS (SELECT 1 FROM accountgame ag WHERE ag.game_id=g.id)
        ORDER BY g.app_id
        """
    ).fetchall()
    return {int(app_id): int(game_id) for app_id, game_id in rows}


def fetch_json(params: dict[str, Any], timeout: int = 45) -> Any:
    url = BASE_URL + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": "GameAccess-catalog-enricher/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def normalized_tags(value: Any, max_tags: int) -> list[tuple[str, int]]:
    if not isinstance(value, dict):
        return []
    tags: list[tuple[str, int]] = []
    for name, weight in value.items():
        label = str(name).strip()
        if not label:
            continue
        try:
            numeric = int(weight)
        except (TypeError, ValueError):
            numeric = 0
        tags.append((label, numeric))
    tags.sort(key=lambda item: (-item[1], item[0].casefold()))
    return tags[:max_tags]


def upsert_game_tags(
    con: sqlite3.Connection,
    game_id: int,
    tags: list[tuple[str, int]],
) -> None:
    con.execute("DELETE FROM game_tag WHERE game_id=? AND source='steamspy'", (game_id,))
    con.executemany(
        """
        INSERT INTO game_tag(game_id,name,source,weight)
        VALUES (?,?, 'steamspy', ?)
        ON CONFLICT(game_id,name,source) DO UPDATE SET weight=excluded.weight
        """,
        [(game_id, name, weight) for name, weight in tags],
    )


def load_cache() -> dict[str, Any]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not CACHE_PATH.exists():
        return {}
    try:
        value = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def save_cache(cache: dict[str, Any]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def import_bulk_pages(
    con: sqlite3.Connection,
    targets: dict[int, int],
    start_page: int,
    pages: int,
    max_tags: int,
) -> tuple[int, int]:
    matched = 0
    inserted = 0
    for offset in range(pages):
        page = start_page + offset
        if offset:
            # SteamSpy documents a 60-second rate limit for the all endpoint.
            time.sleep(61)
        payload = fetch_json({"request": "all", "page": page}, timeout=90)
        if not isinstance(payload, dict) or not payload:
            break
        page_matched = 0
        for key, item in payload.items():
            if not isinstance(item, dict):
                continue
            try:
                app_id = int(item.get("appid") or key)
            except (TypeError, ValueError):
                continue
            game_id = targets.get(app_id)
            if not game_id:
                continue
            tags = normalized_tags(item.get("tags"), max_tags)
            if not tags:
                continue
            upsert_game_tags(con, game_id, tags)
            page_matched += 1
            matched += 1
            inserted += len(tags)
        con.commit()
        print(f"bulk page {page}: matched={page_matched}, total_matched={matched}, tags={inserted}", flush=True)
    return matched, inserted


def import_appdetails(
    con: sqlite3.Connection,
    targets: dict[int, int],
    limit: int,
    max_tags: int,
) -> tuple[int, int]:
    cache = load_cache()
    fetched = 0
    inserted = 0

    # Rehydrate any cached responses first. This makes the JSON cache portable
    # and lets a rebuilt SQLite database recover tags without network calls.
    for app_id, game_id in targets.items():
        item = cache.get(str(app_id))
        if not isinstance(item, dict):
            continue
        tags = normalized_tags(item.get("tags"), max_tags)
        if tags:
            upsert_game_tags(con, game_id, tags)
    con.commit()

    for app_id, game_id in targets.items():
        key = str(app_id)
        if key in cache:
            continue
        if fetched:
            # SteamSpy documents 1 request/sec for normal endpoints.
            time.sleep(1.05)
        try:
            item = fetch_json({"request": "appdetails", "appid": app_id})
        except Exception as exc:
            print(f"appdetails {app_id}: {exc}", flush=True)
            continue
        cache[key] = item
        save_cache(cache)
        tags = normalized_tags(item.get("tags") if isinstance(item, dict) else None, max_tags)
        if tags:
            upsert_game_tags(con, game_id, tags)
            inserted += len(tags)
        fetched += 1
        if fetched % 25 == 0:
            con.commit()
            print(f"appdetails newly_fetched={fetched}, new_tags={inserted}", flush=True)
        if limit and fetched >= limit:
            break
    con.commit()
    return fetched, inserted


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich GameAccess game_tag with SteamSpy community tags.")
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--bulk-start-page", type=int, default=0)
    parser.add_argument("--bulk-pages", type=int, default=0)
    parser.add_argument("--appdetails-limit", type=int, default=0)
    parser.add_argument("--max-tags", type=int, default=20)
    args = parser.parse_args()

    con = sqlite3.connect(args.database)
    try:
        targets = load_targets(con)
        print(f"licensed target apps={len(targets)}", flush=True)
        if args.bulk_pages:
            import_bulk_pages(con, targets, args.bulk_start_page, args.bulk_pages, args.max_tags)
        if args.appdetails_limit:
            import_appdetails(con, targets, args.appdetails_limit, args.max_tags)
        games_with_tags, tag_rows = con.execute(
            "SELECT count(distinct game_id), count(*) FROM game_tag WHERE source='steamspy'"
        ).fetchone()
        print(f"steamspy games_with_tags={games_with_tags}, tag_rows={tag_rows}", flush=True)
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
