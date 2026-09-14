from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import Engine


CATALOG_SCHEMA_VERSION = 1


def _json(value: Any, default: Any) -> str:
    return json.dumps(value if value is not None else default, ensure_ascii=False, separators=(",", ":"))


def _required_age(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return max(0, int(value))
    match = re.search(r"\d+", str(value or ""))
    return int(match.group(0)) if match else None


def _adult_classification(metadata: dict[str, Any]) -> tuple[int | None, str | None]:
    age = _required_age(metadata.get("required_age"))
    descriptors = metadata.get("content_descriptors") if isinstance(metadata.get("content_descriptors"), dict) else {}
    notes = str(descriptors.get("notes") or "")
    lowered = notes.casefold()
    if age is not None and age >= 18:
        return 1, f"steam-required-age:{age}"
    strong_markers = (
        "adult only",
        "adults only",
        "sexual content",
        "nudity",
        "mature sexual",
        "not appropriate for all ages",
    )
    if any(marker in lowered for marker in strong_markers):
        return 1, "steam-content-descriptor-notes"
    if age is not None and age > 0:
        return 0, f"steam-required-age:{age}"
    return None, None


def _feature_flags(categories: list[str]) -> dict[str, int | None]:
    values = {str(item).casefold() for item in categories}
    contains = lambda *needles: int(any(any(needle in value for needle in needles) for value in values))
    return {
        "single_player": contains("single-player", "single player"),
        "multiplayer": contains("multi-player", "multiplayer"),
        "coop": contains("co-op", "coop"),
        "online_coop": contains("online co-op", "online coop"),
        "local_coop": contains("local co-op", "local coop"),
        "shared_split_screen": contains("shared/split screen", "split screen"),
        "mmo": contains("mmo", "massively multiplayer"),
        "pvp": contains("pvp"),
    }


def ensure_catalog_schema(engine: Engine) -> None:
    ddl = [
        """
        CREATE TABLE IF NOT EXISTS game_metadata (
            game_id INTEGER PRIMARY KEY REFERENCES game(id) ON DELETE CASCADE,
            app_id INTEGER UNIQUE,
            product_type TEXT,
            steam_name TEXT,
            short_description TEXT,
            about_the_game TEXT,
            detailed_description TEXT,
            controller_support TEXT,
            developers_json TEXT NOT NULL DEFAULT '[]',
            publishers_json TEXT NOT NULL DEFAULT '[]',
            supported_languages TEXT,
            release_date TEXT,
            coming_soon INTEGER,
            required_age INTEGER,
            required_age_raw TEXT,
            is_adult INTEGER,
            adult_basis TEXT,
            content_descriptor_ids_json TEXT NOT NULL DEFAULT '[]',
            content_descriptor_notes TEXT,
            ratings_json TEXT NOT NULL DEFAULT '{}',
            windows INTEGER,
            mac INTEGER,
            linux INTEGER,
            single_player INTEGER,
            multiplayer INTEGER,
            coop INTEGER,
            online_coop INTEGER,
            local_coop INTEGER,
            shared_split_screen INTEGER,
            mmo INTEGER,
            pvp INTEGER,
            min_players INTEGER,
            max_players INTEGER,
            local_players_max INTEGER,
            online_players_max INTEGER,
            players_source TEXT,
            minimum_requirements TEXT,
            recommended_requirements TEXT,
            metacritic_score INTEGER,
            metacritic_url TEXT,
            recommendation_count INTEGER,
            achievement_count INTEGER,
            is_free INTEGER,
            price_currency TEXT,
            price_initial INTEGER,
            price_final INTEGER,
            price_discount_percent INTEGER,
            website TEXT,
            support_url TEXT,
            support_email TEXT,
            header_image TEXT,
            capsule_image TEXT,
            hero_image TEXT,
            background TEXT,
            steam_url TEXT,
            steam_json TEXT,
            source TEXT,
            metadata_state TEXT NOT NULL DEFAULT 'pending',
            metadata_fetched_at TEXT,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS game_genre (
            game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            PRIMARY KEY (game_id, name)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS game_category (
            game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            PRIMARY KEY (game_id, name)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS game_tag (
            game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'steam',
            weight INTEGER,
            PRIMARY KEY (game_id, name, source)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS game_data_path (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
            data_type TEXT NOT NULL,
            platform TEXT NOT NULL,
            path TEXT NOT NULL,
            source TEXT NOT NULL,
            source_url TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE (game_id, data_type, platform, path, source)
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_game_metadata_product_type ON game_metadata(product_type)",
        "CREATE INDEX IF NOT EXISTS ix_game_metadata_is_adult ON game_metadata(is_adult)",
        "CREATE INDEX IF NOT EXISTS ix_game_metadata_state ON game_metadata(metadata_state)",
        "CREATE INDEX IF NOT EXISTS ix_game_metadata_release_date ON game_metadata(release_date)",
        "CREATE INDEX IF NOT EXISTS ix_game_genre_name ON game_genre(name)",
        "CREATE INDEX IF NOT EXISTS ix_game_category_name ON game_category(name)",
        "CREATE INDEX IF NOT EXISTS ix_game_tag_name ON game_tag(name)",
        "CREATE INDEX IF NOT EXISTS ix_game_data_path_game_type ON game_data_path(game_id, data_type)",
    ]
    with engine.begin() as conn:
        for statement in ddl:
            conn.exec_driver_sql(statement)
        try:
            conn.exec_driver_sql(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS game_search_fts USING fts5(
                    game_id UNINDEXED,
                    app_id UNINDEXED,
                    name,
                    genres,
                    categories,
                    tags,
                    developers,
                    publishers,
                    description,
                    tokenize='unicode61 remove_diacritics 2'
                )
                """
            )
        except Exception:
            # FTS5 is present in normal Python/SQLite builds, but the catalog
            # remains valid if an unusual runtime omits it.
            pass


def seed_known_games(engine: Engine) -> int:
    now = datetime.now(timezone.utc).isoformat()
    with engine.begin() as conn:
        before = conn.exec_driver_sql("SELECT COUNT(*) FROM game_metadata").scalar_one()
        conn.exec_driver_sql(
            """
            INSERT OR IGNORE INTO game_metadata (
                game_id, app_id, steam_name, metadata_state, updated_at
            )
            SELECT id, app_id, name, 'pending', ?
            FROM game
            WHERE app_id IS NOT NULL
            """,
            (now,),
        )
        after = conn.exec_driver_sql("SELECT COUNT(*) FROM game_metadata").scalar_one()
    return int(after) - int(before)


def _replace_names(conn: Any, table: str, game_id: int, values: list[str]) -> None:
    conn.exec_driver_sql(f"DELETE FROM {table} WHERE game_id = ?", (game_id,))
    rows = sorted({str(value).strip() for value in values if str(value).strip()})
    if rows:
        conn.exec_driver_sql(
            f"INSERT OR IGNORE INTO {table}(game_id, name) VALUES (?, ?)",
            [(game_id, value) for value in rows],
        )


def upsert_steam_metadata(engine: Engine, game_id: int, metadata: dict[str, Any], fetched_at: str | None = None) -> None:
    app_id = int(metadata.get("app_id") or 0)
    if app_id <= 0:
        raise ValueError("Steam metadata requires a positive app_id")
    genres = [str(item) for item in metadata.get("genres") or []]
    categories = [str(item) for item in metadata.get("categories") or []]
    developers = [str(item) for item in metadata.get("developers") or []]
    publishers = [str(item) for item in metadata.get("publishers") or []]
    descriptors = metadata.get("content_descriptors") if isinstance(metadata.get("content_descriptors"), dict) else {}
    descriptor_ids = [int(item) for item in descriptors.get("ids") or [] if str(item).isdigit()]
    price = metadata.get("price") if isinstance(metadata.get("price"), dict) else {}
    metacritic = metadata.get("metacritic") if isinstance(metadata.get("metacritic"), dict) else {}
    support = metadata.get("support_info") if isinstance(metadata.get("support_info"), dict) else {}
    adult, adult_basis = _adult_classification(metadata)
    flags = _feature_flags(categories)
    now = datetime.now(timezone.utc).isoformat()
    fetched = fetched_at or now

    params = {
        "game_id": game_id,
        "app_id": app_id,
        "product_type": metadata.get("type"),
        "steam_name": metadata.get("name"),
        "short_description": metadata.get("short_description"),
        "about_the_game": metadata.get("about_the_game"),
        "detailed_description": metadata.get("detailed_description"),
        "controller_support": metadata.get("controller_support"),
        "developers_json": _json(developers, []),
        "publishers_json": _json(publishers, []),
        "supported_languages": metadata.get("supported_languages"),
        "release_date": metadata.get("release_date"),
        "coming_soon": int(bool(metadata.get("coming_soon"))) if metadata.get("coming_soon") is not None else None,
        "required_age": _required_age(metadata.get("required_age")),
        "required_age_raw": None if metadata.get("required_age") is None else str(metadata.get("required_age")),
        "is_adult": adult,
        "adult_basis": adult_basis,
        "content_descriptor_ids_json": _json(descriptor_ids, []),
        "content_descriptor_notes": descriptors.get("notes"),
        "ratings_json": _json(metadata.get("ratings"), {}),
        "windows": int(bool(metadata.get("windows"))) if metadata.get("windows") is not None else None,
        "mac": int(bool(metadata.get("mac"))) if metadata.get("mac") is not None else None,
        "linux": int(bool(metadata.get("linux"))) if metadata.get("linux") is not None else None,
        **flags,
        "minimum_requirements": metadata.get("minimum_requirements"),
        "recommended_requirements": metadata.get("recommended_requirements"),
        "metacritic_score": metacritic.get("score"),
        "metacritic_url": metacritic.get("url"),
        "recommendation_count": metadata.get("recommendation_count"),
        "achievement_count": metadata.get("achievement_count"),
        "is_free": int(bool(metadata.get("is_free"))) if metadata.get("is_free") is not None else None,
        "price_currency": price.get("currency"),
        "price_initial": price.get("initial"),
        "price_final": price.get("final"),
        "price_discount_percent": price.get("discount_percent"),
        "website": metadata.get("website"),
        "support_url": support.get("url"),
        "support_email": support.get("email"),
        "header_image": metadata.get("header_image"),
        "capsule_image": metadata.get("capsule_image"),
        "hero_image": metadata.get("hero_image"),
        "background": metadata.get("background"),
        "steam_url": metadata.get("steam_url"),
        "steam_json": _json(metadata, {}),
        "source": metadata.get("source") or "steam-store",
        "metadata_state": "ready",
        "metadata_fetched_at": fetched,
        "updated_at": now,
    }
    columns = list(params)
    assignments = ", ".join(f"{column}=:{column}" for column in columns if column != "game_id")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            f"UPDATE game_metadata SET {assignments} WHERE game_id=:game_id",
            params,
        )
        _replace_names(conn, "game_genre", game_id, genres)
        _replace_names(conn, "game_category", game_id, categories)


def import_appinfo_catalog(engine: Engine, appinfo: dict[int, dict[str, Any]]) -> dict[str, int]:
    """Fill cheap identity/type/platform fields from Steam's local appinfo cache.

    This source is intentionally not considered full detail metadata: rows stay
    pending until Steam Store detail enrichment provides descriptions,
    requirements, categories, ratings, media, etc.
    """
    updated = 0
    missing = 0
    now = datetime.now(timezone.utc).isoformat()
    with engine.begin() as conn:
        game_ids = {
            int(row[0]): int(row[1])
            for row in conn.exec_driver_sql(
                "SELECT app_id, id FROM game WHERE app_id IS NOT NULL"
            ).all()
        }
        for app_id, item in appinfo.items():
            game_id = game_ids.get(int(app_id))
            if not game_id:
                missing += 1
                continue
            oslist = {
                part.strip().casefold()
                for part in str(item.get("oslist") or "").split(",")
                if part.strip()
            }
            developer = str(item.get("developer") or "").strip()
            publisher = str(item.get("publisher") or "").strip()
            adult_flag = bool(
                item.get("has_adult_content")
                or item.get("has_adult_content_sex")
                or item.get("has_adult_content_violence")
            )
            conn.exec_driver_sql(
                """
                UPDATE game_metadata
                SET
                    product_type=COALESCE(NULLIF(product_type,''), ?),
                    steam_name=COALESCE(NULLIF(steam_name,''), ?),
                    developers_json=CASE
                        WHEN developers_json IS NULL OR developers_json='[]' THEN ?
                        ELSE developers_json END,
                    publishers_json=CASE
                        WHEN publishers_json IS NULL OR publishers_json='[]' THEN ?
                        ELSE publishers_json END,
                    windows=COALESCE(windows, ?),
                    mac=COALESCE(mac, ?),
                    linux=COALESCE(linux, ?),
                    is_adult=CASE
                        WHEN ? THEN 1
                        ELSE is_adult END,
                    adult_basis=CASE
                        WHEN ? THEN 'steam-appinfo-adult-flags'
                        ELSE adult_basis END,
                    source=CASE
                        WHEN metadata_state='pending' THEN 'steam-appinfo'
                        ELSE source END,
                    updated_at=?
                WHERE game_id=?
                """,
                (
                    str(item.get("type") or "").strip() or None,
                    str(item.get("name") or "").strip() or None,
                    _json([developer] if developer else [], []),
                    _json([publisher] if publisher else [], []),
                    int("windows" in oslist) if oslist else None,
                    int("macos" in oslist or "mac" in oslist) if oslist else None,
                    int("linux" in oslist) if oslist else None,
                    int(adult_flag),
                    int(adult_flag),
                    now,
                    game_id,
                ),
            )
            updated += 1
    rebuild_search_index(engine)
    return {"appinfo_rows": len(appinfo), "updated": updated, "not_in_catalog": missing}


def get_cached_steam_metadata(engine: Engine, game_id: int) -> dict[str, Any] | None:
    with engine.begin() as conn:
        row = conn.exec_driver_sql(
            "SELECT steam_json FROM game_metadata WHERE game_id=? AND metadata_state='ready'",
            (int(game_id),),
        ).first()
    if not row or not row[0]:
        return None
    try:
        value = json.loads(row[0])
        return value if isinstance(value, dict) else None
    except Exception:
        return None


def rebuild_search_index(engine: Engine) -> bool:
    with engine.begin() as conn:
        try:
            conn.exec_driver_sql("DELETE FROM game_search_fts")
        except Exception:
            return False
        conn.exec_driver_sql(
            """
            INSERT INTO game_search_fts(
                game_id, app_id, name, genres, categories, tags, developers, publishers, description
            )
            SELECT
                g.id,
                g.app_id,
                COALESCE(NULLIF(m.steam_name, ''), g.name),
                COALESCE((SELECT group_concat(name, ' ') FROM game_genre WHERE game_id=g.id), ''),
                COALESCE((SELECT group_concat(name, ' ') FROM game_category WHERE game_id=g.id), ''),
                COALESCE((SELECT group_concat(name, ' ') FROM game_tag WHERE game_id=g.id), ''),
                COALESCE(json_extract(m.developers_json, '$') , ''),
                COALESCE(json_extract(m.publishers_json, '$') , ''),
                COALESCE(m.short_description, '')
            FROM game g
            JOIN game_metadata m ON m.game_id=g.id
            WHERE g.app_id IS NOT NULL
            """
        )
    return True


def import_steam_cache(engine: Engine, cache_dir: Path) -> dict[str, int]:
    seed_known_games(engine)
    imported = 0
    skipped = 0
    failed = 0
    files = sorted(Path(cache_dir).glob("*.json"))
    with engine.begin() as conn:
        game_ids = {
            int(row[0]): int(row[1])
            for row in conn.exec_driver_sql(
                "SELECT app_id, id FROM game WHERE app_id IS NOT NULL"
            ).all()
        }
    for path in files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            metadata = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(metadata, dict):
                skipped += 1
                continue
            app_id = int(metadata.get("app_id") or 0)
            game_id = game_ids.get(app_id)
            if not game_id:
                skipped += 1
                continue
            timestamp = payload.get("cached_at")
            fetched_at = None
            if isinstance(timestamp, (int, float)):
                fetched_at = datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
            upsert_steam_metadata(engine, game_id, metadata, fetched_at=fetched_at)
            imported += 1
        except Exception:
            failed += 1
    rebuild_search_index(engine)
    return {
        "known_games": len(game_ids),
        "cache_files": len(files),
        "imported": imported,
        "skipped": skipped,
        "failed": failed,
    }


def coverage(engine: Engine) -> dict[str, int]:
    with engine.begin() as conn:
        known = int(conn.exec_driver_sql("SELECT COUNT(*) FROM game_metadata").scalar_one())
        ready = int(conn.exec_driver_sql("SELECT COUNT(*) FROM game_metadata WHERE metadata_state='ready'").scalar_one())
        pending = int(conn.exec_driver_sql("SELECT COUNT(*) FROM game_metadata WHERE metadata_state='pending'").scalar_one())
        save_rows = int(conn.exec_driver_sql("SELECT COUNT(*) FROM game_data_path WHERE data_type='save'").scalar_one())
        genres = int(conn.exec_driver_sql("SELECT COUNT(*) FROM game_genre").scalar_one())
        categories = int(conn.exec_driver_sql("SELECT COUNT(*) FROM game_category").scalar_one())
    return {
        "known_games": known,
        "steam_ready": ready,
        "steam_pending": pending,
        "save_location_rows": save_rows,
        "genre_rows": genres,
        "category_rows": categories,
    }
