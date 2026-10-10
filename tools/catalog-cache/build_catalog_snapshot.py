#!/usr/bin/env python
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text


REPO_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPO_ROOT / "apps" / "api"
DEFAULT_SQLITE = API_ROOT / "gameaccess.db"
OUTPUT_DIR = REPO_ROOT / "deploy" / "catalog-cache"
sys.path.insert(0, str(API_ROOT))
from app.catalog_snapshot import write_snapshot


def normalize_database_url(raw: str) -> str:
    value = raw.strip()
    if value.startswith("postgres://"):
        value = "postgresql+psycopg://" + value[len("postgres://"):]
    elif value.startswith("postgresql://"):
        value = "postgresql+psycopg://" + value[len("postgresql://"):]
    if "supabase.com" in value and "sslmode=" not in value:
        value += ("&" if "?" in value else "?") + "sslmode=require"
    return value


def database_url(arg: str | None) -> str:
    raw = (arg or os.environ.get("GAMEACCESS_DATABASE_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if raw:
        return normalize_database_url(raw)
    return f"sqlite:///{DEFAULT_SQLITE.as_posix()}"


def parse_json(raw: Any, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        value = json.loads(raw)
        return value
    except (TypeError, ValueError):
        return fallback


def steam_assets(app_id: int | None) -> dict[str, str | None]:
    if not app_id:
        return {
            "header_image": None,
            "capsule_image": None,
            "hero_image": None,
            "steam_url": None,
        }
    base = f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}"
    return {
        "header_image": f"{base}/header.jpg",
        "capsule_image": f"{base}/library_600x900_2x.jpg",
        "hero_image": f"{base}/library_hero.jpg",
        "steam_url": f"https://store.steampowered.com/app/{app_id}/",
    }


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def load_names(conn, table: str) -> dict[int, list[str]]:
    rows = conn.execute(text(f"""
        SELECT DISTINCT n.game_id, n.name
        FROM {table} n
        JOIN game g ON g.id=n.game_id
        WHERE g.active = true
        ORDER BY n.game_id, lower(n.name), n.name
    """)).all()
    result: dict[int, list[str]] = {}
    for game_id, name in rows:
        result.setdefault(int(game_id), []).append(str(name))
    return result


def build_snapshot(source_url: str, output_dir: Path, github_ref: str) -> tuple[Path, Path]:
    engine = create_engine(source_url)
    output_dir.mkdir(parents=True, exist_ok=True)

    with engine.connect() as conn:
        games = conn.execute(text("""
            SELECT DISTINCT
                g.id, g.slug, g.name, g.app_id, g.credit_cost_per_hour,
                m.short_description, m.developers_json, m.publishers_json,
                m.release_date, m.recommendation_count, m.metacritic_score,
                m.single_player, m.multiplayer, m.coop, m.online_coop,
                m.local_coop, m.shared_split_screen, m.mmo, m.pvp,
                m.steam_review_score, m.steam_review_count,
                m.header_image, m.capsule_image, m.hero_image, m.steam_url,
                m.steam_json, m.min_players, m.max_players,
                m.local_players_max, m.online_players_max, m.players_source
            FROM game g
            JOIN game_metadata m ON m.game_id=g.id
            WHERE g.active = true
              AND lower(coalesce(m.product_type, '')) = 'game'
              AND lower(trim(coalesce(g.name, ''))) <> ('steam ' || CAST(g.app_id AS TEXT))
                ORDER BY g.id
        """)).mappings().all()

        genres = load_names(conn, "game_genre")
        categories = load_names(conn, "game_category")
        tags = load_names(conn, "game_tag")

        try:
            locale_rows = conn.execute(text("""
                SELECT l.game_id, l.language, l.country, l.steam_json
                FROM game_metadata_locale l
                JOIN game g ON g.id=l.game_id
                WHERE g.active = true
                        ORDER BY l.game_id, l.language, l.country
            """)).mappings().all()
        except Exception:
            # Legacy/local SQLite databases predate localized metadata. The
            # canonical game_metadata row is still exported below as spanish/ar.
            locale_rows = []

    catalog_rows: list[tuple[int, int | None, str]] = []
    canonical_by_id: dict[int, dict[str, Any]] = {}
    content_hasher = hashlib.sha256()

    for row in games:
        game_id = int(row["id"])
        app_id = int(row["app_id"]) if row["app_id"] is not None else None
        assets = steam_assets(app_id)
        payload = {
            "id": game_id,
            "slug": row["slug"],
            "name": row["name"],
            "app_id": app_id,
            "credit_cost_per_hour": int(row["credit_cost_per_hour"] or 0),
            "copies_total": 0,
            "copies_available": 0,
            "availability_state": "unavailable",
            "header_image": row["header_image"] or assets["header_image"],
            "capsule_image": row["capsule_image"] or assets["capsule_image"],
            "hero_image": row["hero_image"] or assets["hero_image"],
            "steam_url": row["steam_url"] or assets["steam_url"],
            "genres": genres.get(game_id, []),
            "categories": categories.get(game_id, []),
            "tags": tags.get(game_id, []),
            "developers": parse_json(row["developers_json"], []),
            "publishers": parse_json(row["publishers_json"], []),
            "short_description": row["short_description"] or "",
            "release_date": row["release_date"],
            "recommendation_count": row["recommendation_count"],
            "steam_review_score": row["steam_review_score"],
            "steam_review_count": row["steam_review_count"],
            "metacritic_score": row["metacritic_score"],
            "single_player": None if row["single_player"] is None else bool(row["single_player"]),
            "multiplayer": None if row["multiplayer"] is None else bool(row["multiplayer"]),
            "coop": None if row["coop"] is None else bool(row["coop"]),
            "online_coop": None if row["online_coop"] is None else bool(row["online_coop"]),
            "local_coop": None if row["local_coop"] is None else bool(row["local_coop"]),
            "shared_split_screen": None if row["shared_split_screen"] is None else bool(row["shared_split_screen"]),
            "mmo": None if row["mmo"] is None else bool(row["mmo"]),
            "pvp": None if row["pvp"] is None else bool(row["pvp"]),
            **{key: row[key] for key in ("min_players", "max_players", "local_players_max", "online_players_max", "players_source")},
        }
        encoded = stable_json(payload)
        content_hasher.update(encoded.encode("utf-8"))
        catalog_rows.append((game_id, app_id, encoded))
        canonical_by_id[game_id] = {
            "catalog": payload,
            "steam_json": parse_json(row["steam_json"], None),
        }

    detail_rows: dict[tuple[int, str, str], str] = {}
    for row in locale_rows:
        game_id = int(row["game_id"])
        if game_id not in canonical_by_id:
            continue
        steam = parse_json(row["steam_json"], None)
        if not isinstance(steam, dict):
            continue
        detail = {
            **canonical_by_id[game_id]["catalog"],
            "steam": steam,
            "metadata_state": "ready",
        }
        key = (game_id, str(row["language"]).casefold(), str(row["country"]).casefold())
        encoded = stable_json(detail)
        detail_rows[key] = encoded
        content_hasher.update(encoded.encode("utf-8"))

    for game_id, data in canonical_by_id.items():
        key = (game_id, "spanish", "ar")
        if key in detail_rows or not isinstance(data["steam_json"], dict):
            continue
        detail = {
            **data["catalog"],
            "steam": data["steam_json"],
            "metadata_state": "ready",
        }
        encoded = stable_json(detail)
        detail_rows[key] = encoded
        content_hasher.update(encoded.encode("utf-8"))

    return write_snapshot(catalog_rows, detail_rows, output_dir, github_ref)




def main() -> int:
    parser = argparse.ArgumentParser(description="Build the static GameAccess client catalog cache.")
    parser.add_argument("--database-url", help="SQLAlchemy database URL. Defaults to GAMEACCESS_DATABASE_URL/DATABASE_URL/local SQLite.")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--github-ref", default="dev")
    args = parser.parse_args()
    build_snapshot(database_url(args.database_url), args.output_dir, args.github_ref)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
