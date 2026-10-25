"""Steam Account Manager: the user's Steam client, its remembered accounts and the games each one owns.

    client.py     find Steam, read loginusers.vdf, libraryfolders.vdf and the appmanifest_*.acf files (read-only)
    ownership.py  which account owns each game (LastOwner on disk, the owned list from the GameAccess server)
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
    # Bring the Steam games of the remembered accounts (installed and owned) into the library on its own.
    "auto_import": True,
    # Sign Steam in to the game's owner before playing.
    "switch_accounts": True,
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
        return self.settings()

    def save_settings(self, values: dict) -> dict:
        current = self.settings()
        for name in DEFAULT_SETTINGS:
            if name in values:
                current[name] = bool(values[name])
        self.cache.mkdir(parents=True, exist_ok=True)
        write_json(self.cache / "settings.json", current)
        return self.public_settings()

    # -- what Steam has ----------------------------------------------------------------------------
    def accounts(self) -> list[SteamAccount]:
        """Only the accounts Steam signs in to on its own ("Remember me"): Game Access can switch to those without a
        password. The others are left out entirely, their games too."""
        return [a for a in client.read_accounts(self.root) if a.remembered] if self.root else []

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

    def owned(self, refresh: bool = False, fetch: bool = True, api_url: str = "") -> dict:
        """{"fetched_at", "accounts": {id64: [{app_id, name}]}, "private": [id64], "errors": {id64: text}} from the cache,
        refreshed from the GameAccess server (`api_url`) when it is older than 12 hours or `refresh`. Without a server
        address, or with `fetch=False` (the library list never waits for the network), only the cache is read."""
        path = self.cache / "owned.json"
        try:
            cached = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        except (OSError, ValueError):
            cached = {}
        remembered = {a.steam_id64 for a in self.accounts()}
        kept = {"fetched_at": cached.get("fetched_at", 0), "private": [i for i in cached.get("private", []) if i in remembered],
                "accounts": {k: v for k, v in cached.get("accounts", {}).items() if k in remembered},
                "errors": {k: v for k, v in cached.get("errors", {}).items() if k in remembered}}
        fresh = time.time() - float(kept["fetched_at"]) < OWNED_MAX_AGE and remembered <= set(kept["accounts"])
        if not api_url or not fetch or not remembered or (fresh and not refresh):
            return kept
        try:
            kwargs = {"opener": self.opener} if self.opener else {}
            answer = fetch_owned_games(api_url, sorted(remembered), **kwargs)
        except Exception as error:          # server asleep or offline: keep what was known
            self.log.warning("Steam owned games not refreshed: %s", str(error)[:200])
            return kept
        result = {"fetched_at": time.time(), "accounts": {**kept["accounts"], **answer["accounts"]},
                  "private": answer["private"], "errors": answer["errors"]}
        self.log.info("Steam owned games: %s accounts, %s games, %s private, %s errors", len(answer["accounts"]),
                      sum(len(v) for v in answer["accounts"].values()), len(answer["private"]), len(answer["errors"]))
        self.cache.mkdir(parents=True, exist_ok=True)
        write_json(path, result)
        return result

    def table(self, refresh: bool = False, fetch: bool = True, api_url: str = "") -> tuple[dict[int, dict], dict[int, str]]:
        """Ownership of every installed or owned game of the remembered accounts, and the name of each one."""
        owned = self.owned(refresh, fetch, api_url)
        ids = {id64: [g["app_id"] for g in games] for id64, games in owned["accounts"].items()}
        names = {g["app_id"]: g["name"] for games in owned["accounts"].values() for g in games}
        installed = self.installed()
        names.update({g.app_id: g.name for g in installed})
        table = ownership_table(self.accounts(), installed, ids, active_id64())
        # A game installed with an account Steam does not remember is not this user's to play through Game Access.
        return {app_id: info for app_id, info in table.items() if info["owner_name"]}, names

    def status(self) -> dict:
        accounts = self.accounts()
        installed = self.installed()
        owned = self.owned(fetch=False)
        active = active_id64()
        return {"found": bool(self.root), "path": str(self.root or ""), "active_id64": active,
                "accounts": [{**a.to_dict(), "active": a.steam_id64 == active,
                              "owned_count": len(owned["accounts"].get(a.steam_id64, [])),
                              "installed_count": sum(1 for g in installed if g.owner_id64 == a.steam_id64),
                              "private": a.steam_id64 in owned["private"],
                              "error": owned["errors"].get(a.steam_id64, "")} for a in accounts],
                "libraries": [str(p.parent) for p in self.libraries() if p.is_dir()],
                "installed_count": len(installed), "owned_count": len({g["app_id"] for v in owned["accounts"].values() for g in v}),
                "owned_fetched_at": owned["fetched_at"], "settings": self.public_settings()}

    # -- the library connector ---------------------------------------------------------------------
    def sync(self, linked, refresh: bool = False, exclude: set[int] = frozenset(), api_url: str = "") -> dict:
        """Link every installed game of a remembered account not in the library yet (and not in `exclude`); return them
        and the owned ones not installed (asked to the GameAccess server at `api_url`)."""
        if not self.root:
            return {"found": False, "linked": [], "owned": []}
        table, names = self.table(refresh, api_url=api_url)
        new = []
        for game in self.installed():
            if game.app_id not in table or game.app_id in exclude or not game.fully_installed or linked.get(game.app_id) or not Path(game.folder).is_dir():
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
