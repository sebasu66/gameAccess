"""Steam Account Manager: the user's Steam client, its remembered accounts and the games each one owns.

    client.py     find Steam, read loginusers.vdf, libraryfolders.vdf and the appmanifest_*.acf files (read-only)
    ownership.py  which account owns each game (LastOwner on disk, the Web API list for games not installed)
    switch.py     sign Steam in to the owner and run the game

It talks to the Game Library Manager: installed Steam games become *linked* games (never moved, frozen or
uninstalled by Game Access), and owned games that are not installed are listed so the library can offer
"Install", which hands the game to Steam (`steam://install/<appid>`): Steam asks the library folder and checks space.
Game Access never downloads Steam games through its own download sources."""
from __future__ import annotations
import json
import os
import time
from pathlib import Path
import app_log
from atomic_json import write_json
from launcher_data import data_dir
from . import client
from .client import SteamAccount
from .ownership import fetch_owned_games, ownership_table
from .switch import SteamSwitcher, active_id64

OWNED_MAX_AGE = 12 * 3600
DEFAULT_SETTINGS = {
    # Bring the installed Steam games (and, with a key, the owned ones) into the library on its own.
    "auto_import": True,
    # Sign Steam in to the game's owner before playing.
    "switch_accounts": True,
    # Steam Web API key (https://steamcommunity.com/dev/apikey), only to list owned games that are not installed.
    "api_key": "",
}


class SteamAccountManager:
    def __init__(self, launcher: Path, steam_root: Path | None | bool = None, logger=None, opener=None, switcher=None):
        self.cache = data_dir(launcher) / ".cache" / "steam_accounts"
        self.root = client.find_steam() if steam_root is None else (steam_root or None)
        self.log = logger or app_log.manager_logger("steam")
        self.opener = opener
        self.switcher = switcher

    # -- settings ------------------------------------------------------------------------------
    def settings(self) -> dict:
        path = self.cache / "settings.json"
        try:
            saved = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        except (OSError, ValueError):
            saved = {}
        return {**DEFAULT_SETTINGS, **{k: v for k, v in saved.items() if k in DEFAULT_SETTINGS}}

    def public_settings(self) -> dict:
        """What the UI sees: never the key itself."""
        values = self.settings()
        key = values.pop("api_key")
        return {**values, "has_api_key": bool(key)}

    def save_settings(self, values: dict) -> dict:
        current = self.settings()
        for name in ("auto_import", "switch_accounts"):
            if name in values:
                current[name] = bool(values[name])
        if "api_key" in values:
            key = str(values["api_key"] or "").strip()
            if key and not (len(key) == 32 and all(c in "0123456789abcdefABCDEF" for c in key)):
                raise ValueError("La clave de la API de Steam tiene 32 caracteres (0-9, A-F).")
            if key != current["api_key"]:
                (self.cache / "owned.json").unlink(missing_ok=True)
            current["api_key"] = key
        self.cache.mkdir(parents=True, exist_ok=True)
        write_json(self.cache / "settings.json", current)
        return self.public_settings()

    # -- what Steam has ----------------------------------------------------------------------------
    def accounts(self) -> list[SteamAccount]:
        return client.read_accounts(self.root) if self.root else []

    def libraries(self) -> list[Path]:
        return client.read_libraries(self.root) if self.root else []

    def installed(self) -> list[client.InstalledSteamGame]:
        games = client.installed_games(self.libraries())
        types = self._app_types({g.app_id for g in games})
        return [g for g in games if types.get(g.app_id, "game") in ("game", "demo", "beta", "")]

    def _app_types(self, app_ids: set[int]) -> dict[int, str]:
        """Steam's app type per AppID. appinfo.vdf is tens of MB, so the answers are kept in `types.json` and the file
        is read again only for AppIDs never seen."""
        path = self.cache / "types.json"
        try:
            known = {int(k): v for k, v in json.loads(path.read_text(encoding="utf-8")).items()} if path.is_file() else {}
        except (OSError, ValueError):
            known = {}
        missing = set(app_ids) - set(known)
        if self.root and missing:
            try:
                from steam_appinfo import read_local_app_catalog
                found = read_local_app_catalog(Path(self.root) / "appcache" / "appinfo.vdf", missing)
            except (OSError, ValueError):
                found = None
            if found is not None:
                # An AppID the local Steam does not know stays unknown (""), which counts as a game.
                known.update({app_id: str((found.get(app_id) or {}).get("type", "")).lower() for app_id in missing})
                self.cache.mkdir(parents=True, exist_ok=True)
                write_json(path, {str(k): v for k, v in known.items()})
        return known

    def owned(self, refresh: bool = False, fetch: bool = True) -> dict:
        """{"fetched_at", "accounts": {id64: [{app_id, name}]}, "errors": {id64: text}} from the cache, refreshed from the
        Web API when it is older than 12 hours (or `refresh`) and there is a key. `fetch=False` only reads the cache
        (the library list must never wait for the network)."""
        path = self.cache / "owned.json"
        try:
            cached = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        except (OSError, ValueError):
            cached = {}
        key = self.settings()["api_key"]
        fresh = time.time() - float(cached.get("fetched_at", 0)) < OWNED_MAX_AGE
        if not key or not fetch or (fresh and not refresh):
            return {"fetched_at": cached.get("fetched_at", 0), "accounts": cached.get("accounts", {}) if key else {},
                    "errors": cached.get("errors", {}) if key else {}}
        result = {"fetched_at": time.time(), "accounts": {}, "errors": {}}
        for account in self.accounts():
            try:
                kwargs = {"opener": self.opener} if self.opener else {}
                result["accounts"][account.steam_id64] = fetch_owned_games(key, account.steam_id64, **kwargs)
            except Exception as error:      # one private profile or network hiccup never stops the rest
                result["errors"][account.steam_id64] = str(error)[:200]
                result["accounts"][account.steam_id64] = cached.get("accounts", {}).get(account.steam_id64, [])
        self.log.info("Steam owned games: %s accounts, %s games, %s errors", len(result["accounts"]),
                      sum(len(v) for v in result["accounts"].values()), len(result["errors"]))
        self.cache.mkdir(parents=True, exist_ok=True)
        write_json(path, result)
        return result

    def table(self, refresh: bool = False, fetch: bool = True) -> tuple[dict[int, dict], dict[int, str]]:
        """Ownership of every installed or owned game, and the name of each owned one."""
        owned = self.owned(refresh, fetch)
        ids = {id64: [g["app_id"] for g in games] for id64, games in owned["accounts"].items()}
        names = {g["app_id"]: g["name"] for games in owned["accounts"].values() for g in games}
        installed = self.installed()
        names.update({g.app_id: g.name for g in installed})
        return ownership_table(self.accounts(), installed, ids, active_id64()), names

    def status(self) -> dict:
        accounts = self.accounts()
        installed = self.installed()
        owned = self.owned(fetch=False)
        active = active_id64()
        return {"found": bool(self.root), "path": str(self.root or ""), "active_id64": active,
                "accounts": [{**a.to_dict(), "active": a.steam_id64 == active,
                              "owned_count": len(owned["accounts"].get(a.steam_id64, [])),
                              "installed_count": sum(1 for g in installed if g.owner_id64 == a.steam_id64),
                              "error": owned["errors"].get(a.steam_id64, "")} for a in accounts],
                "libraries": [str(p.parent) for p in self.libraries() if p.is_dir()],
                "installed_count": len(installed), "owned_count": len({g["app_id"] for v in owned["accounts"].values() for g in v}),
                "owned_fetched_at": owned["fetched_at"], "settings": self.public_settings()}

    # -- the library connector ---------------------------------------------------------------------
    def sync(self, linked, refresh: bool = False, exclude: set[int] = frozenset()) -> dict:
        """Link every installed Steam game not in the library yet (and not in `exclude`); return them and the owned
        ones not installed."""
        if not self.root:
            return {"found": False, "linked": [], "owned": []}
        table, names = self.table(refresh)
        new = []
        for game in self.installed():
            if game.app_id in exclude or not game.fully_installed or linked.get(game.app_id) or not Path(game.folder).is_dir():
                continue
            linked.link(game.app_id, game.name, game.folder, "steam")
            new.append({"app_id": game.app_id, "name": game.name, **table.get(game.app_id, {})})
        owned = [{"app_id": app_id, "name": names.get(app_id, ""), **info} for app_id, info in table.items()
                 if not info["installed"] and not linked.get(app_id) and app_id not in exclude]
        self.log.info("Steam sync: %s newly linked, %s owned and not installed", len(new), len(owned))
        return {"found": True, "linked": new, "owned": owned}

    def owner_of(self, app_id: int) -> dict:
        table, _ = self.table(fetch=False)
        return table.get(int(app_id), {})

    def library_rows(self, linked_ids: set[int]) -> tuple[dict[int, dict], list[dict]]:
        """For the library list, from what is on disk and cached (no network): the owner of every Steam game, and a
        row for each owned game that is neither installed nor linked."""
        if not self.root:
            return {}, []
        table, names = self.table(fetch=False)
        rows = [{"app_id": app_id, "name": names.get(app_id) or str(app_id), **info} for app_id, info in table.items()
                if not info["installed"] and app_id not in linked_ids]
        return table, rows

    # -- play and install ----------------------------------------------------------------------------
    def play(self, app_id: int) -> dict:
        """Sign Steam in to the owner when needed, then ask Steam to run the game."""
        info = self.owner_of(app_id)
        outcome = {"steam_owner": info.get("owner_name", ""), "switched": False}
        if self.root and self.settings()["switch_accounts"] and info.get("owner_name"):
            switcher = self.switcher or SteamSwitcher(Path(self.root) / "steam.exe", self.log)
            outcome.update(switcher.ensure_account(client.id32(info["owner_id64"]), info["owner_name"]))
        os.startfile(f"steam://rungameid/{int(app_id)}")
        return {**outcome, "command": f"steam://rungameid/{int(app_id)}"}

    @staticmethod
    def install(app_id: int) -> dict:
        """Steam installs it: it asks which library folder and checks the space itself."""
        os.startfile(f"steam://install/{int(app_id)}")
        return {"command": f"steam://install/{int(app_id)}"}
