from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from . import main as core

router = APIRouter(prefix="/steam", tags=["steam-search"])
STORE_SEARCH_URL = "https://store.steampowered.com/api/storesearch/"


def _price(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    return {
        "currency": raw.get("currency"),
        "initial": raw.get("initial"),
        "final": raw.get("final"),
        "discount_percent": raw.get("discount_percent") or 0,
    }


@router.get("/search")
def search_steam(
    q: str = Query(min_length=2, max_length=120),
    limit: int = Query(default=20, ge=1, le=50),
    session: Session = Depends(core.get_session),
) -> dict:
    """Search the public Steam Store, then overlay GameAccess license state.

    This intentionally searches beyond the GameAccess pool. Results that exist
    in our active catalog include their current license/capacity summary; other
    Steam games remain discoverable with `catalog_game=None`.
    """
    try:
        with httpx.Client(timeout=8.0, follow_redirects=True) as client:
            response = client.get(
                STORE_SEARCH_URL,
                params={"term": q.strip(), "l": "spanish", "cc": "ar"},
                headers={"User-Agent": "gameAccess/0.2 Steam search"},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        raise HTTPException(502, f"Steam search failed: {exc}") from exc

    raw_items = payload.get("items") if isinstance(payload, dict) else []
    if not isinstance(raw_items, list):
        raw_items = []

    app_ids = [int(item.get("id")) for item in raw_items[:limit] if isinstance(item, dict) and str(item.get("id", "")).isdigit()]
    catalog_by_app: dict[int, core.Game] = {}
    if app_ids:
        games = session.exec(select(core.Game).where(core.Game.app_id.in_(app_ids))).all()
        catalog_by_app = {int(game.app_id): game for game in games if game.app_id is not None and game.active}

    results: list[dict[str, Any]] = []
    for item in raw_items[:limit]:
        if not isinstance(item, dict) or not str(item.get("id", "")).isdigit():
            continue
        app_id = int(item["id"])
        game = catalog_by_app.get(app_id)
        catalog_game = core.game_summary(session, game) if game else None
        platforms = item.get("platforms") if isinstance(item.get("platforms"), dict) else {}
        results.append(
            {
                "app_id": app_id,
                "name": str(item.get("name") or f"Steam {app_id}"),
                "image_url": item.get("tiny_image") or f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}/header.jpg",
                "price": _price(item.get("price")),
                "platforms": {
                    "windows": bool(platforms.get("windows")),
                    "mac": bool(platforms.get("mac")),
                    "linux": bool(platforms.get("linux")),
                },
                "catalog_game": catalog_game,
                "access_state": (
                    "available"
                    if catalog_game and catalog_game.get("copies_available", 0) > 0
                    else "busy"
                    if catalog_game and catalog_game.get("copies_total", 0) > 0
                    else "not-in-pool"
                ),
                "steam_url": f"https://store.steampowered.com/app/{app_id}/",
            }
        )

    return {"query": q.strip(), "count": len(results), "results": results}
