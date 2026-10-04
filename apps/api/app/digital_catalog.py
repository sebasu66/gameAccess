from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import Engine
from sqlmodel import Field as SQLField, Session, SQLModel, select

from .catalog_metadata import (
    ensure_catalog_schema,
    rebuild_search_index,
    save_steam_review_summary,
    seed_known_games,
    upsert_steam_metadata,
    upsert_steam_metadata_locale,
)
from .database import engine as default_engine
from .steam_catalog import SteamCatalogAdapter, SteamCatalogError

logger = logging.getLogger("gameaccess.digital_catalog")

DEFAULT_CATALOG_PATH = Path(__file__).resolve().parent / "digital_catalog.json"
FALLBACK_CATALOG_PATH = Path(__file__).resolve().parents[1] / "digital_catalog.json"
STEAM_CACHE_DIR = Path(__file__).resolve().parents[1] / ".steam_cache"


class DigitalGame(SQLModel, table=True):
    __tablename__ = "digital_game"
    id: Optional[int] = SQLField(default=None, primary_key=True)
    steam_app_id: int = SQLField(index=True, unique=True)
    name: str
    download_source: str = ""
    install_process: str = ""
    play_process: str = ""
    uninstall_process: str = ""
    updated_at: str = ""


def get_digital_catalog_path(override_path: Path | str | None = None) -> Path:
    if override_path:
        p = Path(override_path)
        if p.exists():
            return p
    if DEFAULT_CATALOG_PATH.exists():
        return DEFAULT_CATALOG_PATH
    if FALLBACK_CATALOG_PATH.exists():
        return FALLBACK_CATALOG_PATH
    return DEFAULT_CATALOG_PATH


def load_digital_catalog_json(catalog_path: Path | str | None = None) -> list[dict[str, Any]]:
    path = get_digital_catalog_path(catalog_path)
    if not path.exists():
        logger.warning("Digital catalog JSON not found at %s", path)
        return []
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict) and "id" in item]
    return []


def _generate_slug(session: Session, name: str, app_id: int, game_cls: type) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-") or f"steam-{app_id}"
    slug = base
    suffix = 2
    while session.exec(select(game_cls).where(getattr(game_cls, "slug") == slug)).first():
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def sync_digital_catalog(
    engine: Engine | None = None,
    catalog_path: Path | str | None = None,
    fetch_steam: bool = True,
    fetch_reviews: bool = False,
    force: bool = False,
    rate_limit_delay: float = 0.5,
    steam_adapter: SteamCatalogAdapter | None = None,
) -> dict[str, Any]:
    """Reads digital_catalog.json and automatically fetches Steam store details to add/update them in the DB.

    Works seamlessly with both Supabase PostgreSQL (via configured DATABASE_URL)
    and SQLite development databases.
    """
    db_engine = engine or default_engine

    # Ensure all tables and catalog metadata schema exist.
    SQLModel.metadata.create_all(db_engine)
    ensure_catalog_schema(db_engine)

    # Lazy-import Game from main to avoid circular imports.
    from .main import Game

    records = load_digital_catalog_json(catalog_path)
    if not records:
        return {
            "ok": True,
            "total": 0,
            "processed": 0,
            "steam_enriched": 0,
            "errors": ["No records found in digital_catalog.json"],
            "games": [],
        }

    adapter = steam_adapter or SteamCatalogAdapter(STEAM_CACHE_DIR)
    now = datetime.now(timezone.utc).isoformat()

    results: list[dict[str, Any]] = []
    enriched_count = 0
    errors: list[str] = []

    for index, item in enumerate(records):
        raw_id = item.get("id")
        try:
            app_id = int(raw_id)
        except (ValueError, TypeError):
            errors.append(f"Invalid app id: {raw_id}")
            continue

        raw_name = str(item.get("name") or "").strip() or f"Steam {app_id}"
        download_source = str(item.get("downloadSource") or "").strip()
        install_process = str(item.get("installProcess") or "").strip()
        play_process = str(item.get("playProcess") or "").strip()
        uninstall_process = str(item.get("uninstallProcess") or "").strip()

        # 1. Upsert into DigitalGame table
        with Session(db_engine) as session:
            digital_entry = session.exec(
                select(DigitalGame).where(DigitalGame.steam_app_id == app_id)
            ).first()
            if digital_entry is None:
                digital_entry = DigitalGame(
                    steam_app_id=app_id,
                    name=raw_name,
                    download_source=download_source,
                    install_process=install_process,
                    play_process=play_process,
                    uninstall_process=uninstall_process,
                    updated_at=now,
                )
            else:
                digital_entry.name = raw_name
                digital_entry.download_source = download_source
                digital_entry.install_process = install_process
                digital_entry.play_process = play_process
                digital_entry.uninstall_process = uninstall_process
                digital_entry.updated_at = now
            session.add(digital_entry)

            # 2. Upsert into Game table
            game_entry = session.exec(
                select(Game).where(Game.app_id == app_id)
            ).first()
            if game_entry is None:
                slug = _generate_slug(session, raw_name, app_id, Game)
                game_entry = Game(
                    slug=slug,
                    name=raw_name,
                    app_id=app_id,
                    credit_cost_per_hour=100,
                    active=True,
                )
            else:
                game_entry.active = True
                if raw_name:
                    game_entry.name = raw_name
            session.add(game_entry)
            session.commit()
            session.refresh(game_entry)
            game_id = game_entry.id

        # 3. Ensure game_metadata row exists
        seed_known_games(db_engine)

        # 4. Fetch Steam store details
        steam_data: dict[str, Any] | None = None
        if fetch_steam:
            try:
                steam_data = adapter.fetch(app_id, language="spanish", country="ar", force=force)
                # Update game title with official steam title if available
                steam_title = str(steam_data.get("name") or "").strip()
                if steam_title:
                    with Session(db_engine) as session:
                        g = session.get(Game, game_id)
                        if g:
                            g.name = steam_title
                            session.add(g)
                            session.commit()

                # Upsert metadata into database
                upsert_steam_metadata(db_engine, game_id, steam_data)
                upsert_steam_metadata_locale(db_engine, game_id, "spanish", "ar", steam_data)

                if fetch_reviews:
                    try:
                        reviews = adapter.fetch_review_summary(app_id)
                        save_steam_review_summary(db_engine, game_id, reviews)
                    except Exception as rev_err:
                        logger.warning("Could not fetch reviews for AppID %s: %s", app_id, rev_err)

                enriched_count += 1
            except SteamCatalogError as exc:
                err_msg = f"Steam fetch failed for AppID {app_id} ({raw_name}): {exc}"
                logger.warning(err_msg)
                errors.append(err_msg)
            except Exception as exc:
                err_msg = f"Unexpected error enriching AppID {app_id} ({raw_name}): {exc}"
                logger.exception(err_msg)
                errors.append(err_msg)

        results.append({
            "game_id": game_id,
            "app_id": app_id,
            "name": raw_name,
            "steam_enriched": steam_data is not None,
        })

        if fetch_steam and index < len(records) - 1 and rate_limit_delay > 0:
            time.sleep(rate_limit_delay)

    # Rebuild FTS search index if SQLite
    rebuild_search_index(db_engine)

    return {
        "ok": True,
        "total": len(records),
        "processed": len(results),
        "steam_enriched": enriched_count,
        "errors": errors,
        "games": results,
    }
