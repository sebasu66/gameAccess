from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from . import main as core
from .provider_app_registration import is_placeholder_name, placeholder_name

router = APIRouter(prefix="/admin/pool", tags=["pool"])

_METADATA_MIN_INTERVAL_SECONDS = 1.0
_METADATA_LAST_FETCH_STARTED = 0.0
_METADATA_FETCH_LOCK = Lock()
_METADATA_QUEUE_LOCK = Lock()
_METADATA_PENDING: set[int] = set()
_METADATA_EXECUTOR = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="gameaccess-steam-metadata",
)


def _unique_slug(session: Session, name: str, app_id: int) -> str:
    base = core.slugify(name, app_id)
    slug = base
    suffix = 2
    while session.exec(select(core.Game).where(core.Game.slug == slug)).first():
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def register_app_id(session: Session, app_id: int) -> tuple[core.Game, bool]:
    """Persist verified Steam access immediately, without waiting for metadata.

    Unknown AppIDs stay visible as ``Steam <appid>`` while their metadata is
    resolved asynchronously. Once classified, only real Windows games remain
    active; DLC/tools/etc. are filtered by ``enrich_app_id``.
    """
    app_id = int(app_id)
    game = session.exec(select(core.Game).where(core.Game.app_id == app_id)).first()
    if game is not None:
        if is_placeholder_name(app_id, game.name) and not game.active:
            game.active = True
            session.add(game)
            session.commit()
            session.refresh(game)
        return game, False

    name = placeholder_name(app_id)
    game = core.Game(
        slug=_unique_slug(session, name, app_id),
        name=name,
        app_id=app_id,
        credit_cost_per_hour=10,
        active=True,
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
    """Classify/enrich one AppID; metadata failure never invalidates access."""
    metadata: dict[str, Any] | None = None
    for attempt in range(4):
        try:
            metadata = _fetch_metadata_throttled(app_id)
            break
        except core.SteamCatalogError:
            if attempt < 3:
                time.sleep(min(60.0, 5.0 * (2**attempt)))

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


def _run_queued_enrichment(app_id: int) -> None:
    try:
        enrich_app_id(app_id)
    finally:
        with _METADATA_QUEUE_LOCK:
            _METADATA_PENDING.discard(app_id)


def queue_metadata_enrichment(app_id: int) -> bool:
    """Queue one AppID on the server's single metadata worker."""
    app_id = int(app_id)
    with _METADATA_QUEUE_LOCK:
        if app_id in _METADATA_PENDING:
            return False
        _METADATA_PENDING.add(app_id)
    _METADATA_EXECUTOR.submit(_run_queued_enrichment, app_id)
    return True


def resume_pending_metadata() -> int:
    """Resume metadata work after API restart and keep placeholders visible."""
    queued = 0
    with Session(core.engine) as session:
        mapped_game_ids = {
            row.game_id for row in session.exec(select(core.AccountGame)).all()
        }
        games = session.exec(select(core.Game)).all()
        for game in games:
            if game.id not in mapped_game_ids or not game.app_id:
                continue
            pending_placeholder = is_placeholder_name(int(game.app_id), game.name)
            stale_inactive = not game.active
            if not pending_placeholder and not stale_inactive:
                continue
            # A verified/mapped AppID may have been left inactive by an older
            # partial sync or stale metadata result. Recheck it asynchronously.
            # Keep known inactive rows hidden until metadata confirms they are
            # real Windows games; placeholders stay visible while pending.
            if pending_placeholder and not game.active:
                game.active = True
                session.add(game)
            if queue_metadata_enrichment(int(game.app_id)):
                queued += 1
        session.commit()
    return queued


@router.on_event("startup")
def resume_provider_metadata_on_startup() -> None:
    resume_pending_metadata()


@router.get("/metadata-queue/status")
def metadata_queue_status() -> dict:
    with _METADATA_QUEUE_LOCK:
        pending = len(_METADATA_PENDING)
    return {
        "ok": True,
        "pending": pending,
        "workers": 1,
        "min_interval_seconds": _METADATA_MIN_INTERVAL_SECONDS,
    }


@router.post("/games/register-steam/{app_id}")
def register_steam_app(
    app_id: int,
    session: Session = Depends(core.get_session),
) -> dict:
    if app_id <= 0:
        raise HTTPException(400, "invalid Steam AppID")

    game, created = register_app_id(session, app_id)
    pending = is_placeholder_name(app_id, game.name)
    needs_recheck = pending or not game.active
    queued = queue_metadata_enrichment(app_id) if needs_recheck else False

    return {
        "ok": True,
        "created": created,
        "metadata_state": "pending" if needs_recheck else "ready",
        "metadata_queued": queued,
        "game": {
            "id": game.id,
            "app_id": game.app_id,
            "name": game.name,
            "active": game.active,
        },
    }
