from __future__ import annotations

import time
from threading import Lock
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlmodel import Session, select

from . import main as core
from .provider_app_registration import is_placeholder_name, placeholder_name

router = APIRouter(prefix="/admin/pool", tags=["pool"])

_METADATA_FETCH_LOCK = Lock()
_METADATA_MIN_INTERVAL_SECONDS = 1.0
_METADATA_LAST_FETCH_STARTED = 0.0


def _unique_slug(session: Session, name: str, app_id: int) -> str:
    base = core.slugify(name, app_id)
    slug = base
    suffix = 2
    while session.exec(select(core.Game).where(core.Game.slug == slug)).first():
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def register_app_id(session: Session, app_id: int) -> tuple[core.Game, bool]:
    """Persist Steam ownership identity without requiring Store metadata."""
    app_id = int(app_id)
    game = session.exec(select(core.Game).where(core.Game.app_id == app_id)).first()
    if game is not None:
        return game, False

    name = placeholder_name(app_id)
    game = core.Game(
        slug=_unique_slug(session, name, app_id),
        name=name,
        app_id=app_id,
        credit_cost_per_hour=10,
        active=False,
    )
    session.add(game)
    session.commit()
    session.refresh(game)
    return game, True


def _fetch_metadata_throttled(app_id: int) -> dict[str, Any]:
    global _METADATA_LAST_FETCH_STARTED
    with _METADATA_FETCH_LOCK:
        elapsed = time.monotonic() - _METADATA_LAST_FETCH_STARTED
        if elapsed < _METADATA_MIN_INTERVAL_SECONDS:
            time.sleep(_METADATA_MIN_INTERVAL_SECONDS - elapsed)
        _METADATA_LAST_FETCH_STARTED = time.monotonic()
        return core.steam_catalog.fetch(app_id)


def enrich_app_id(app_id: int) -> None:
    """Best-effort Store enrichment; failure never invalidates ownership."""
    metadata: dict[str, Any] | None = None
    for attempt in range(3):
        try:
            metadata = _fetch_metadata_throttled(app_id)
            break
        except core.SteamCatalogError:
            if attempt < 2:
                time.sleep(5.0 * (2**attempt))

    if metadata is None:
        return

    with Session(core.engine) as session:
        game = session.exec(select(core.Game).where(core.Game.app_id == app_id)).first()
        if game is None:
            return
        game.name = str(metadata.get("name") or placeholder_name(app_id)).strip()
        game.active = (
            str(metadata.get("type") or "").casefold() == "game"
            and bool(metadata.get("windows"))
        )
        session.add(game)
        session.commit()


@router.post("/games/register-steam/{app_id}")
def register_steam_app(
    app_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(core.get_session),
) -> dict:
    if app_id <= 0:
        raise HTTPException(400, "invalid Steam AppID")

    game, created = register_app_id(session, app_id)
    pending = is_placeholder_name(app_id, game.name)
    if pending:
        background_tasks.add_task(enrich_app_id, app_id)

    return {
        "ok": True,
        "created": created,
        "metadata_state": "pending" if pending else ("ready" if game.active else "filtered"),
        "game": {
            "id": game.id,
            "app_id": game.app_id,
            "name": game.name,
            "active": game.active,
        },
    }
