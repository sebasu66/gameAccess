"""Catalog routes. The client reads the catalog and game details from GitHub and Steam, never from here."""
from __future__ import annotations
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlmodel import Session, select
from .models import Game
from .api_dependencies import get_session
from .steam_client import steam_catalog
from .steam_catalog import SteamCatalogError
from .catalog_metadata import CATALOG_ALLOWED_PRODUCT_TYPES, catalog_metadata_for_games

router = APIRouter()

_ALLOWED_PRODUCT_TYPES_SQL = ", ".join(
    f"'{product_type}'" for product_type in sorted(CATALOG_ALLOWED_PRODUCT_TYPES)
)
CATALOG_PRODUCT_FILTER = text(
    "EXISTS ("
    "SELECT 1 FROM game_metadata AS catalog_metadata "
    "WHERE catalog_metadata.game_id = game.id "
    f"AND lower(coalesce(catalog_metadata.product_type, '')) IN ({_ALLOWED_PRODUCT_TYPES_SQL})"
    ") AND lower(trim(coalesce(game.name, ''))) <> ('steam ' || CAST(game.app_id AS TEXT))"
)


def game_summary(session: Session, game: Game, catalog_metadata: dict | None = None) -> dict:
    data = catalog_metadata or catalog_metadata_for_games(session.get_bind(), [int(game.id)], connection=session.connection()).get(int(game.id), {})
    return {**data, "id": game.app_id, "app_id": game.app_id, "slug": game.slug, "name": game.name,
            "credit_cost_per_hour": 0, "copies_total": 0, "copies_available": 0}


def slugify(value: str, app_id: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or f"steam-{app_id}"


@router.post("/admin/games/import-steam/{app_id}")
def import_steam_game(app_id: int, session: Session = Depends(get_session)) -> dict:
    try:
        metadata = steam_catalog.fetch(app_id)
    except SteamCatalogError as exc:
        raise HTTPException(502, str(exc)) from exc

    name = str(metadata.get("name") or f"Steam {app_id}").strip()
    existing = session.exec(select(Game).where(Game.app_id == app_id)).first()
    created = existing is None
    if existing is None:
        base_slug = slugify(name, app_id)
        slug = base_slug
        suffix = 2
        while session.exec(select(Game).where(Game.slug == slug)).first():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        existing = Game(slug=slug, name=name, app_id=app_id, credit_cost_per_hour=100)
    else:
        existing.name = name
        existing.active = True
    session.add(existing)
    session.commit()
    session.refresh(existing)
    return {
        "created": created,
        "game": game_summary(session, existing),
        "steam": metadata,
    }

