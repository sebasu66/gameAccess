from __future__ import annotations

from dataclasses import dataclass

import httpx


PLAYER_SUMMARIES_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"


@dataclass(frozen=True)
class SteamPresence:
    steam_id64: str
    known: bool
    playing: bool
    game_id: int | None = None


def _parse_player_summaries(payload: object, requested: list[str]) -> dict[str, SteamPresence]:
    result = {
        steam_id: SteamPresence(steam_id64=steam_id, known=False, playing=False)
        for steam_id in requested
    }
    if not isinstance(payload, dict):
        return result
    response = payload.get("response")
    if not isinstance(response, dict):
        return result
    players = response.get("players")
    if not isinstance(players, list):
        return result

    for raw in players:
        if not isinstance(raw, dict):
            continue
        steam_id = str(raw.get("steamid") or "").strip()
        if steam_id not in result:
            continue
        raw_game_id = str(raw.get("gameid") or "").strip()
        game_id = int(raw_game_id) if raw_game_id.isdigit() else None
        result[steam_id] = SteamPresence(
            steam_id64=steam_id,
            known=True,
            playing=game_id is not None,
            game_id=game_id,
        )
    return result


def fetch_player_summaries(
    api_key: str,
    steam_ids: list[str],
    *,
    timeout_seconds: float = 8.0,
) -> dict[str, SteamPresence]:
    unique = list(dict.fromkeys(value.strip() for value in steam_ids if value.strip()))
    if not unique:
        return {}
    if len(unique) > 100:
        raise ValueError("GetPlayerSummaries accepts at most 100 SteamIDs per request")
    if not api_key.strip():
        raise ValueError("Steam Web API key is not configured")

    response = httpx.get(
        PLAYER_SUMMARIES_URL,
        params={"steamids": ",".join(unique)},
        headers={"x-webapi-key": api_key.strip(), "Accept": "application/json"},
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    return _parse_player_summaries(response.json(), unique)
