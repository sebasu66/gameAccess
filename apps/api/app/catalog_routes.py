"""Catalog routes."""
from __future__ import annotations
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlmodel import Session, select
from .request_diagnostics import detail
from .models import Game
from .api_dependencies import get_session
from .steam_client import steam_catalog
from .steam_catalog import SteamCatalogError
from .catalog_metadata import CATALOG_ALLOWED_PRODUCT_TYPES, get_cached_steam_metadata, get_cached_steam_metadata_locale, catalog_metadata_for_games, seed_known_games, upsert_steam_metadata, upsert_steam_metadata_locale
_catalog_logger = logging.getLogger("gameaccess.catalog")

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


@router.get("/steam/apps/{app_id}")
def steam_app(
    app_id: int,
    force: bool = False,
    language: str = Query(default="spanish", min_length=2, max_length=32, pattern=r"^[A-Za-z_-]+$"),
    country: str = Query(default="ar", min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$"),
) -> dict:
    try:
        return steam_catalog.fetch(
            app_id,
            language=language.casefold(),
            country=country.casefold(),
            force=force,
        )
    except SteamCatalogError as exc:
        raise HTTPException(502, str(exc)) from exc


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


@router.get("/catalog")
@router.get("/library/catalog")
def library_catalog(session: Session = Depends(get_session)) -> list[dict]:
    """Public game metadata, independent of licenses and external download lists."""
    games = session.exec(
        select(Game).where(
            Game.active == True,  # noqa: E712
            Game.app_id.is_not(None),
            CATALOG_PRODUCT_FILTER,
        ).order_by(Game.id)
    ).all()
    metadata = {}
    ids = [int(game.id) for game in games]
    for start in range(0, len(ids), 400):
        metadata.update(catalog_metadata_for_games(
            session.get_bind(), ids[start:start + 400], connection=session.connection(),
        ))
    database_games = [{
        **metadata.get(int(game.id), {}),
        "id": game.app_id, "app_id": game.app_id,
        "name": game.name, "slug": game.slug,
        "credit_cost_per_hour": 0, "copies_total": 0, "copies_available": 0,
    } for game in games]
    from .discovery_service import catalog_games
    by_app = {row["app_id"]: row for row in catalog_games()}
    for row in database_games:
        base = by_app.get(row["app_id"], {})
        merged = {**base, **{key: value for key, value in row.items() if value is not None and value != "" and value != []}}
        for key in ("tags", "genres", "categories"):
            merged[key] = sorted(set(base.get(key, [])) | set(row.get(key, [])))
        by_app[row["app_id"]] = merged
    return list(by_app.values())


@router.get("/digital/games/{app_id}/details")
def digital_game_details(
    request: Request,
    app_id: int,
    language: str = Query(default="spanish"),
    country: str = Query(default="ar"),
    session: Session = Depends(get_session)
) -> dict:
    """Return public cached Steam metadata independently of client activation."""

    language = language.casefold()
    country = country.casefold()
    # Use the injected session instead of opening a new one
    if app_id <= 0:
        raise HTTPException(404, "digital game metadata not found")
    game = session.exec(select(Game).where(Game.app_id == app_id)).first()
    detail("Detail lookup: app_id=%s language=%s existing_record=%s", app_id, language, bool(game))
    if game:
        cached = get_cached_steam_metadata_locale(session.get_bind(), int(game.id), language, country)
        if cached:
            detail("Localized detail cache hit: app_id=%s language=%s", app_id, language)
            return {"steam": cached, "metadata_state": "ready"}
        general = get_cached_steam_metadata(session.get_bind(), int(game.id))
        if general:
            detail("General detail cache hit: app_id=%s", app_id)
            return {"steam": general, "metadata_state": "ready"}
    # A library game can predate the discovery baseline. Fill its durable server
    # record on a genuine cache miss; subsequent opens never re-fetch Steam.
    try:
        detail("Detail cache miss: requesting Steam app_id=%s language=%s", app_id, language)
        metadata = steam_catalog.fetch(app_id, language=language, country=country)
    except SteamCatalogError as exc:
        _catalog_logger.warning("Detail cache miss failed: AppID=%s language=%s", app_id, language)
        raise HTTPException(502, "Game metadata is temporarily unavailable") from exc
    if metadata.get("type") not in CATALOG_ALLOWED_PRODUCT_TYPES or not metadata.get("name"):
        raise HTTPException(404, "Steam game metadata not found")
    if game is None:
        game = Game(slug=f"steam-{app_id}", name=metadata["name"], app_id=app_id, credit_cost_per_hour=0)
        session.add(game)
        session.commit()
        session.refresh(game)
    seed_known_games(session.get_bind())
    upsert_steam_metadata(session.get_bind(), int(game.id), metadata)
    upsert_steam_metadata_locale(session.get_bind(), int(game.id), language, country, metadata)
    _catalog_logger.info("Detail cache populated: AppID=%s game_id=%s language=%s; preserved for later opens", app_id, game.id, language)
    return {"steam": metadata, "metadata_state": "ready"}
