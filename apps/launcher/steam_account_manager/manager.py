"""Steam Account Manager: the user's Steam accounts (account libraries), the Steam client and the games each one owns.

    client.py     find Steam, read loginusers.vdf, libraryfolders.vdf and the appmanifest_*.acf files (read-only)
    ownership.py  which account owns each game (LastOwner on disk, the owned list from the GameAccess server)
    switch.py     sign Steam in to the owner and run the game

The accounts are the ones the user registered by signing in with Steam (account_registry.py): each one's library is
shown whole, never game by game. Its installed games are mirrored as *linked* records (how they are played), which the
sync alone adds and removes; owned games that are not installed are listed so the library can offer "Install", which
hands the game to Steam (`steam://install/<appid>`): Steam asks the library folder and checks space. The accounts this
PC's Steam remembers are only suggestions to register. Game Access never downloads Steam games through its own sources."""
from __future__ import annotations
import json
import os
import shutil
import time
from pathlib import Path
import app_log
from atomic_json import write_json
from launcher_data import data_dir
from . import client
from .client import SteamAccount
from .ownership import fetch_owned_games, ownership_table
from .switch import SteamSwitcher, active_id64
from account_registry import AccountRegistry
import re
import urllib.request

STEAM_ID64 = re.compile(r"^7656119\d{10}$")
LINK_STATE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")

OWNED_MAX_AGE = 12 * 3600
DEFAULT_SETTINGS = {
    # Kept for older settings files; the registered accounts' libraries are always synced whole.
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
        self.registry = AccountRegistry(launcher)

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
    def local_accounts(self) -> list[SteamAccount]:
        """The accounts this PC's Steam knows (loginusers.vdf), registered or not."""
        return client.read_accounts(self.root) if self.root else []

    def accounts(self) -> list[SteamAccount]:
        """The registered accounts, with what this PC's Steam knows of each: its sign-in name and whether Steam signs
        in to it on its own ("Remember me": Game Access can switch to it without a password)."""
        local = {a.steam_id64: a for a in self.local_accounts()}
        result = []
        for row in self.registry.all("steam"):
            id64 = str(row["account_id"])
            known = local.get(id64)
            result.append(SteamAccount(id64, known.account_name if known else "", row.get("name") or (known.persona_name if known else ""),
                                       bool(known and known.remembered), bool(known and known.most_recent)))
        return result

    def suggestions(self) -> list[dict]:
        """Accounts this PC's Steam remembers that are not registered: offered to sign in and add, never added alone."""
        registered = set(self.registry.ids("steam"))
        return [a.to_dict() for a in self.local_accounts() if a.remembered and a.steam_id64 not in registered]

    # -- registering an account: Steam's own sign-in page, through the GameAccess server ---------------------
    def _server(self, api_url: str, path: str, data: bytes | None = None) -> dict:
        if not api_url.startswith(("https://", "http://127.0.0.1", "http://localhost")):
            raise ValueError("Dirección del servidor de Game Access inválida.")
        request = urllib.request.Request(api_url.rstrip("/") + path, data=data, method="POST" if data is not None else "GET",
                                         headers={"Content-Type": "application/json", "User-Agent": "gameAccess launcher"})
        opener = self.opener or urllib.request.urlopen
        with opener(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))

    def link_start(self, api_url: str) -> dict:
        """{state, url}, with `url` opened in the default browser, where the user signs in on Steam's own page. Only an
        address of the GameAccess server itself is opened."""
        answer = self._server(api_url, "/steam/link/start", b"{}")
        url = str(answer.get("url") or "")
        if not LINK_STATE.match(str(answer.get("state") or "")) or not url.startswith(api_url.rstrip("/") + "/steam/link/go/"):
            raise ValueError("El servidor no devolvió una vinculación válida.")
        os.startfile(url)
        return {"state": answer["state"], "url": url, "expires_in": int(answer.get("expires_in") or 600)}

    def link_poll(self, api_url: str, state: str) -> dict:
        """pending / done (the account is registered now) / cancelled / failed / expired."""
        if not LINK_STATE.match(state or ""):
            raise ValueError("Vinculación inválida.")
        answer = self._server(api_url, f"/steam/link/result/{state}")
        status = str(answer.get("status") or "expired")
        if status != "done":
            return {"status": status}
        id64 = str(answer.get("steam_id") or "")
        if not STEAM_ID64.match(id64):
            return {"status": "failed"}
        local = next((a for a in self.local_accounts() if a.steam_id64 == id64), None)
        account = self.registry.add("steam", id64, str(answer.get("persona") or "") or (local.persona_name if local else ""))
        self.log.info("Steam account %s registered", id64)
        return {"status": "done", "account": account}

    def remove_account(self, id64: str, linked=None) -> dict:
        """The account's whole library leaves Game Access; Steam and the games on disk are not touched."""
        removed = self.registry.remove("steam", str(id64))
        if removed and linked is not None:
            self.mirror(linked)
        self.log.info("Steam account %s removed: %s", id64, removed)
        return {"removed": removed}

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
        remembered = set(self.registry.ids("steam"))
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
        """Ownership of every installed or owned game of the registered accounts, and the name of each one."""
        owned = self.owned(refresh, fetch, api_url)
        ids = {id64: [g["app_id"] for g in games] for id64, games in owned["accounts"].items()}
        names = {g["app_id"]: g["name"] for games in owned["accounts"].values() for g in games}
        installed = self.installed()
        names.update({g.app_id: g.name for g in installed})
        table = ownership_table(self.accounts(), installed, ids, active_id64())
        # Only the registered accounts' libraries: a game installed with another account is not shown.
        registered = set(self.registry.ids("steam"))
        return {app_id: {**info, "owner_name": info["owner_name"] or info["owner_persona"]} for app_id, info in table.items()
                if info["owner_id64"] in registered}, names

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
                "owned_fetched_at": owned["fetched_at"], "settings": self.public_settings(), "suggestions": self.suggestions()}

    # -- the library connector ---------------------------------------------------------------------
    def mirror(self, linked, table: dict[int, dict] | None = None, exclude: set[int] = frozenset()) -> tuple[list[dict], list[int]]:
        """Make the Steam records exactly the installed games of the registered accounts: add the missing ones, and
        remove those no longer installed or whose account left (the games themselves are never touched). `exclude`:
        AppIDs Game Access has a folder of its own for. Returns (added, removed)."""
        if not self.root:
            return [], []
        table = self.table(fetch=False)[0] if table is None else table
        wanted = {g.app_id: g for g in self.installed()
                  if g.app_id in table and g.fully_installed and g.app_id not in exclude and Path(g.folder).is_dir()}
        same = lambda a, b: os.path.normcase(os.path.normpath(str(a))) == os.path.normcase(os.path.normpath(str(b)))
        added, removed = [], []
        for record in linked.all():
            app_id = int(record["app_id"])
            if record.get("kind") == "steam" and (app_id not in wanted or not same(record.get("path", ""), wanted[app_id].folder)):
                linked.unlink(app_id, hide=False)
                removed.append(app_id)
        for app_id, game in wanted.items():
            if not linked.get(app_id):
                linked.link(app_id, game.name, game.folder, "steam")
                if app_id in removed:
                    removed.remove(app_id)   # the same game, its folder moved: linked again where it is now
                else:
                    added.append({"app_id": app_id, "name": game.name, **table[app_id]})
        return added, removed

    def sync(self, linked, refresh: bool = False, exclude: set[int] = frozenset(), api_url: str = "") -> dict:
        """The registered accounts' libraries, whole: their owned lists refreshed from the GameAccess server (`api_url`)
        and their installed games mirrored (`mirror`). Returns the newly linked, the removed and the owned ones not
        installed."""
        if not self.root:
            return {"found": False, "linked": [], "removed": [], "owned": [], "games": []}
        table, names = self.table(refresh, api_url=api_url)
        new, removed = self.mirror(linked, table, exclude)
        owned = [{"app_id": app_id, "name": names.get(app_id, ""), **info} for app_id, info in table.items()
                 if not info["installed"] and not linked.get(app_id) and app_id not in exclude]
        self.log.info("Steam sync: %s linked, %s removed, %s owned and not installed", len(new), len(removed), len(owned))
        # `games`: every game of the registered accounts' libraries now, so the app drops those that left.
        return {"found": True, "linked": new, "removed": removed, "owned": owned, "games": sorted(table)}

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
    def play(self, app_id: int, command: str = "") -> dict:
        """Sign Steam in to the owner when needed, then ask Steam to run the game (`command`: a steam:// address the
        user set for it, else rungameid)."""
        info = self.owner_of(app_id)
        outcome = {"steam_owner": info.get("owner_name", ""), "switched": False}
        # Only an account Steam remembers can be switched to without a password; for another one Steam asks to sign in.
        if self.root and self.settings()["switch_accounts"] and info.get("remembered") and info.get("owner_name"):
            switcher = self.switcher or SteamSwitcher(Path(self.root) / "steam.exe", self.log)
            outcome.update(switcher.ensure_account(client.id32(info["owner_id64"]), info["owner_name"]))
        command = command or f"steam://rungameid/{int(app_id)}"
        os.startfile(command)
        return {**outcome, "command": command}

    def uninstall(self, app_id: int, linked=None) -> dict:
        """Delete an installed Steam game from disk, as Steam's own "Uninstall" does: its folder under
        steamapps/common, its appmanifest and its Workshop, shader-cache and download leftovers. No Steam account is
        involved (the license stays with its owner, who can install it again). Steam is closed first when it is running:
        it keeps its installed games in memory and would write the manifest back. Saves Steam keeps outside the game
        folder (Steam Cloud, Documents, AppData) are not touched. `linked`: the library's linked games, whose record
        for the game goes without hiding it, so an owned game shows again as "Install"."""
        app_id = int(app_id)
        game = next((g for g in self.installed_all() if g.app_id == app_id), None) or self._in_forgotten_library(app_id, linked)
        if game is None:
            raise ValueError("Steam no tiene instalado este juego.")
        folder = Path(game.folder)
        steamapps = folder.parents[1]
        common = steamapps / "common"
        if folder.parent != common or folder.name in ("", ".", "..") or folder.resolve().parent != common.resolve():
            raise ValueError("La carpeta del juego está fuera de la biblioteca de Steam.")
        if folder.is_symlink() or (hasattr(folder, "is_junction") and folder.is_junction()):
            raise ValueError("La carpeta del juego es un enlace; no se borra.")
        if self.root:
            switcher = self.switcher or SteamSwitcher(Path(self.root) / "steam.exe", self.log)
            if switcher.close("Steam no se cerró a tiempo para desinstalar el juego. Cerralo y volvé a intentar."):
                self.log.info("Steam closed to uninstall AppID %s", app_id)
        leftovers = [steamapps / "workshop" / "content" / str(app_id), steamapps / "shadercache" / str(app_id),
                     steamapps / "downloading" / str(app_id), steamapps / "temp" / str(app_id)]
        for target in (folder, *leftovers):
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
        for target in (steamapps / f"appmanifest_{app_id}.acf", steamapps / "workshop" / f"appworkshop_{app_id}.acf"):
            target.unlink(missing_ok=True)
        if linked is not None:
            linked.unlink(app_id, hide=False)
        self.log.info("Steam game AppID %s uninstalled: %s (%s bytes)", app_id, folder, game.size_bytes)
        return {"folder": str(folder), "freed_bytes": game.size_bytes}

    @staticmethod
    def _in_forgotten_library(app_id: int, linked) -> client.InstalledSteamGame | None:
        """A game linked from a Steam library folder Steam no longer lists (removed from its settings, or a drive it
        forgot): its own manifest beside the folder still says it is that game there."""
        record = linked.get(app_id) if linked is not None else None
        if not record or record.get("kind") != "steam" or not record.get("path"):
            return None
        folder = Path(record["path"])
        if len(folder.parents) < 2 or folder.parent.name.lower() != "common":
            return None
        same = lambda path: os.path.normcase(os.path.normpath(str(path)))
        return next((g for g in client.installed_games([folder.parents[1]])
                     if g.app_id == app_id and same(g.folder) == same(folder)), None)

    def installed_all(self) -> list[client.InstalledSteamGame]:
        """Every game with a manifest in Steam's libraries, whoever owns it (tools and unfinished ones too)."""
        return client.installed_games(self.libraries())

    @staticmethod
    def install(app_id: int) -> dict:
        """Steam installs it: it asks which library folder and checks the space itself."""
        os.startfile(f"steam://install/{int(app_id)}")
        return {"command": f"steam://install/{int(app_id)}"}
