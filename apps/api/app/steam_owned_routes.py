"""Owned Steam games of the accounts a user's Steam remembers, through GameAccess's own Steam Web API key.

The desktop app never holds the key: its launcher sends the SteamIDs Steam remembers on that PC and gets back the
games each one owns (Family Sharing loans excluded by Valve). The key lives only in the server's environment
(`STEAM_WEB_API_KEY`). Answers are cached per SteamID for 12 hours and each address is limited, so all installs
together stay far from Valve's 100,000 calls a day. A private profile answers with no games: it is reported apart."""
from __future__ import annotations

import os
import re
import threading
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/steam", tags=["steam-owned"])
OWNED_GAMES_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
STEAM_ID = re.compile(r"^7656119\d{10}$")
MAX_IDS = 50
CACHE_SECONDS = 12 * 3600
# Per client address: requests per hour (each covers up to MAX_IDS accounts).
REQUESTS_PER_HOUR = 30

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_requests: dict[str, list[float]] = {}
_lock = threading.Lock()


class OwnedGamesRequest(BaseModel):
    steam_ids: list[str] = Field(min_length=1, max_length=MAX_IDS)


def _api_key() -> str:
    return os.environ.get("STEAM_WEB_API_KEY", "").strip()


def _allow(address: str, now: float) -> bool:
    with _lock:
        recent = [t for t in _requests.get(address, []) if now - t < 3600]
        if len(recent) >= REQUESTS_PER_HOUR:
            _requests[address] = recent
            return False
        _requests[address] = [*recent, now]
        return True


def _fetch(client: httpx.Client, key: str, steam_id: str) -> dict[str, Any]:
    response = client.get(OWNED_GAMES_URL, params={"key": key, "steamid": steam_id, "include_appinfo": 1,
                                                    "include_played_free_games": 0, "skip_unvetted_apps": 1, "format": "json"})
    response.raise_for_status()
    body = response.json().get("response") or {}
    games = [{"app_id": int(g["appid"]), "name": str(g.get("name") or "")} for g in body.get("games") or [] if str(g.get("appid", "")).isdigit()]
    # An empty answer without game_count is a private profile (or game details hidden).
    return {"games": games, "private": "game_count" not in body}


@router.post("/owned-games")
def owned_games(payload: OwnedGamesRequest, request: Request) -> dict:
    key = _api_key()
    if not key:
        raise HTTPException(status_code=503, detail="steam_key_missing")
    ids = list(dict.fromkeys(i.strip() for i in payload.steam_ids))
    if not all(STEAM_ID.match(i) for i in ids):
        raise HTTPException(status_code=422, detail="invalid_steam_id")
    now = time.time()
    if not _allow(request.client.host if request.client else "", now):
        raise HTTPException(status_code=429, detail="too_many_requests")
    accounts: dict[str, list[dict]] = {}
    private: list[str] = []
    errors: dict[str, str] = {}
    with httpx.Client(timeout=12.0, headers={"User-Agent": "gameAccess owned-games"}) as client:
        for steam_id in ids:
            with _lock:
                cached = _cache.get(steam_id)
            if cached and now - cached[0] < CACHE_SECONDS:
                result = cached[1]
            else:
                try:
                    result = _fetch(client, key, steam_id)
                except (httpx.HTTPError, ValueError) as error:
                    # Never echo the request URL: it carries the key.
                    errors[steam_id] = type(error).__name__
                    continue
                with _lock:
                    _cache[steam_id] = (now, result)
            accounts[steam_id] = result["games"]
            if result["private"]:
                private.append(steam_id)
    return {"accounts": accounts, "private": private, "errors": errors, "cached_seconds": CACHE_SECONDS}
