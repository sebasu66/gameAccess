"""Which remembered account owns each Steam game.

Installed games: the manifest's `LastOwner` is the account whose license installed and last updated the game.
Games that are not installed: Steam keeps the license list only encrypted on disk (`userdata/<id>/config/licensecache`),
and `localconfig.vdf` lists the apps an account has *touched* (played, Family Sharing, free weekends), not what it
owns. So the owned list comes from the Steam Web API (`IPlayerService/GetOwnedGames`) with the user's own key, which
leaves borrowed Family Sharing games out. Without a key only the installed games are known."""
from __future__ import annotations
import json
import urllib.parse
import urllib.request
from .client import SteamAccount, InstalledSteamGame

OWNED_GAMES_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"


def pick_owner(app_id: int, accounts: list[SteamAccount], owned: dict[str, list[int]], installed_owner: str = "",
               active_id64: str = "") -> SteamAccount | None:
    """The account to play `app_id` with.

    1. The installed copy's LastOwner, when it is a remembered account (that license is the one on disk).
    2. Else an account whose owned list has the game: the one signed in now (no switch needed), then one Steam can
       sign in to without a password, then the first.
    Accounts that only see the game through Family Sharing never appear in `owned`, so they are never picked."""
    by_id = {a.steam_id64: a for a in accounts}
    if installed_owner and installed_owner in by_id:
        return by_id[installed_owner]
    owners = [a for a in accounts if int(app_id) in set(owned.get(a.steam_id64, ()))]
    if not owners:
        return None
    return next((a for a in owners if a.steam_id64 == active_id64), None) or next((a for a in owners if a.remembered), None) or owners[0]


def ownership_table(accounts: list[SteamAccount], installed: list[InstalledSteamGame], owned: dict[str, list[int]],
                    active_id64: str = "") -> dict[int, dict]:
    """{app_id: {owner_id64, owner_name, owner_persona, remembered, installed, size_bytes}} for every installed or owned game.
    An installed game whose LastOwner is not remembered here keeps that id with no account name."""
    table: dict[int, dict] = {}
    on_disk = {g.app_id: g for g in installed}
    for app_id in sorted({*on_disk, *(i for ids in owned.values() for i in ids)}):
        game = on_disk.get(app_id)
        owner = pick_owner(app_id, accounts, owned, game.owner_id64 if game else "", active_id64)
        owner_id = owner.steam_id64 if owner else (game.owner_id64 if game else "")
        table[app_id] = {"owner_id64": owner_id, "owner_name": owner.account_name if owner else "",
                         "owner_persona": owner.persona_name if owner else "", "remembered": bool(owner and owner.remembered),
                         "installed": bool(game and game.fully_installed), "size_bytes": game.size_bytes if game else 0}
    return table


def fetch_owned_games(api_key: str, steam_id64: str, opener=urllib.request.urlopen, timeout: float = 15) -> list[dict]:
    """[{app_id, name}] the account owns. A private profile answers with an empty response: that is an empty list."""
    query = urllib.parse.urlencode({"key": api_key, "steamid": steam_id64, "include_appinfo": 1, "include_played_free_games": 0,
                                    "skip_unvetted_apps": 1, "format": "json"})
    with opener(f"{OWNED_GAMES_URL}?{query}", timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    games = (data.get("response") or {}).get("games") or []
    return [{"app_id": int(g["appid"]), "name": str(g.get("name") or "")} for g in games if str(g.get("appid", "")).isdigit()]
