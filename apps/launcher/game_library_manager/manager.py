"""Game Library Manager: governs the library as a whole.

How many games there are, the state of each, the disk space each folder takes, free space and
whether a download (and its extraction) fits, batch actions, and connectors to the other modules:

    GameExecutionManager  -> analyze / repair a game          (game_execution_manager)
    game_journal          -> per-game history and play counts (game_journal)
    GameImporter          -> bring a folder up to the standard (adopt); import from outside later (game_importer)
    GameFreezer           -> compress rarely used games, two levels (freezer.py)
    SteamAccountManager   -> who owns each Steam game, owned games not installed (steam_account_manager)

Pure Python, no UI: the desktop screen and any future module (play-time limiter, importer) call it."""
from __future__ import annotations
import shutil
import time
from pathlib import Path
import game_journal as journal
from .freeze_control import holder as freeze_holder
import app_log
from game_execution_manager import GameExecutionManager
from disk_space import allocated_size, check_download, check_space, disk_info, folder_size
from game_importer import GameImporter
from game_scanner import GameScanner
from .storage import split_folder_name
from .freezer import GameFreezer
from .linked import deletable_reason
from game_download_manager.ui_text import ui

# linked_delete / linked_move: a game linked from a folder of the player's (never a Steam one) deleted from disk, or
# moved into the games folder and adopted (renamed to <AppID>-<name>-ready, like any game Game Access installs).
BATCH_ACTIONS = ("uninstall", "steam_uninstall", "repair", "analyze", "adopt", "discard_transfer", "linked_delete", "linked_move")


def play_dates(folder: Path) -> list[str]:
    """Timestamps ('YYYY-MM-DD HH:MM:SS') of every launch recorded in the game's log."""
    found = []
    for line in journal.read(folder).splitlines():
        parts = line.split(" | ", 2)
        if len(parts) == 3 and parts[1] == "play" and parts[2].startswith("lanzado"):
            found.append(parts[0])
    return found


def play_history(folder: Path) -> dict:
    """Play count, last launch and when the game came into the library (`added_at`: the first line of its log, or the
    folder's creation when it has none), read from the game's own log. The library counts the days without playing
    from the last launch, or from `added_at` for a game never played (what freezing goes by)."""
    plays, last, added = 0, "", ""
    for line in journal.read(folder).splitlines():
        parts = line.split(" | ", 2)
        if not added and len(parts) >= 2:
            added = parts[0]
        if len(parts) == 3 and parts[1] == "play" and parts[2].startswith("lanzado"):
            plays += 1
            last = parts[0]
    if not added:
        try:
            added = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(Path(folder).stat().st_ctime))
        except OSError:
            pass
    return {"plays": plays, "last_played": last, "added_at": added}


UNFINISHED_MESSAGE = "La descarga no terminó: primero hay que completarla (o descartarla) antes de corregir la carpeta."


def _owner(info: dict) -> dict:
    return {"id64": info.get("owner_id64", ""), "account": info.get("owner_name", ""), "persona": info.get("owner_persona", ""),
            "remembered": bool(info.get("remembered"))}


def on_disk_bytes(game: dict) -> int:
    stored = game.get("frozen_bytes") if game.get("frozen") else None
    return stored if stored is not None else game["size_bytes"] or 0



# Windows' "in use" errors: 32 a sharing violation, 5 access denied (a folder open in Explorer gives either on rename).
IN_USE_ERRORS = {5, 32}


def _in_use(error: BaseException) -> Path | None:
    """The folder an action could not rename or move because another program has it open, or None."""
    if not isinstance(error, OSError) or getattr(error, "winerror", None) not in IN_USE_ERRORS or not error.filename:
        return None
    folder = Path(error.filename)
    return folder if folder.is_dir() else None

class GameLibraryManager:
    def __init__(self, storage, manager=None, importer=None, freezer=None, steam=None):
        self.storage = storage
        self.steam = steam
        self.manager = manager or GameExecutionManager(storage)
        self.log = app_log.manager_logger("library")
        self.importer = importer or GameImporter(storage, self.manager)
        self.freezer = freezer or GameFreezer(storage, self.log)

    # -- inventory -------------------------------------------------------------------------
    def game_folders(self) -> list[Path]:
        linked_paths = {Path(r["path"]).resolve() for r in self.storage.linked.all()}
        found = []
        for root in self.storage.roots:
            if root.is_dir():
                found += [p for p in sorted(root.iterdir()) if p.is_dir() and split_folder_name(p.name)[0] is not None and p.resolve() not in linked_paths]
        return found

    def list_games(self, with_sizes: bool = True) -> list[dict]:
        """The scan: every folder in the games roots with its state, size and what keeps it from the standard."""
        self.clean_empty()
        games = []
        records = self.storage.linked.all()
        # A folder linked where it is (a game left in an old games folder) is listed once, as the linked game.
        linked_paths = {Path(r["path"]).resolve() for r in records}
        for root in self.storage.roots:
            if not root.is_dir():
                continue
            for folder in sorted(root.iterdir()):
                if folder.is_dir() and not folder.is_symlink() and folder.resolve() not in linked_paths:
                    games.append(self._entry(folder, with_sizes))
        owners, owned_rows = self._steam_rows({r["app_id"] for r in records})
        games += [self._linked_entry(record, with_sizes, owners.get(record["app_id"])) for record in records]
        # A game Game Access downloaded keeps its own row; the Steam copy of the same AppID is not listed twice.
        present = {g["app_id"] for g in games}
        games += [row for row in owned_rows if row["app_id"] not in present]
        self._merge_transfers(games, with_sizes)
        flagged = [g for g in games if not g["standard"]]
        self.log.info("Scan: %s folders, %s outside the standard %s", len(games), len(flagged),
                      [(g["name"], [i["code"] for i in g["issues"]]) for g in flagged][:50])
        return games

    def _entry(self, folder: Path, with_sizes: bool) -> dict:
        app_id, title, state = split_folder_name(folder.name)
        entry = {"app_id": app_id, "name": title, "state": state or ("legacy" if app_id is not None else "unrecognized"),
                 "folder": str(folder), "installed": False, "needs_repair": False, "error": "",
                 "size_bytes": folder_size(folder) if with_sizes else None, "plays": 0, "last_played": ""}
        if app_id is None:
            entry["issues"] = self.importer.issues(None, folder, None, None)
            identified = self._identify(folder)
            if identified:
                # Found by the file a Steam emulator or fix leaves (as the importer does): the row is that game, and
                # "Fix" renames the folder to <AppID>-<game> before adopting it.
                entry.update(app_id=identified[0], misnamed=True, identified_by=identified[1])
                entry["issues"] = [{"code": "misnamed", "message": ui("libMisnamed", app_id=identified[0], file=identified[1])}]
        else:
            try:
                status = self.storage.status(app_id, title)
            except ValueError as error:
                status = {}
                entry["issues"] = [{"code": "duplicate_folder", "message": str(error)}]
            entry.update(installed=bool(status.get("installed")), needs_repair=bool(status.get("needs_repair")),
                         error=status.get("error", ""), **play_history(folder))
            source = self.storage.source(app_id)
            entry.update(source_title=source.get("title", ""), source_provider=source.get("provider", ""), label=self.storage.label(app_id))
            frozen = self.freezer.describe(app_id, folder, with_sizes)
            if frozen:
                # The real size is the game's; what it takes on disk now is frozen_bytes.
                entry.update(frozen, size_bytes=frozen["original_bytes"] or entry["size_bytes"])
            if frozen.get("frozen") == "deep":
                entry["issues"] = []  # its files sit in the archive until it is thawed: nothing to analyze or fix
            if "issues" not in entry:
                # Folders still downloading or installing are not a problem: they are just not finished.
                if state in (None, "ready", "ERROR"):
                    analysis = self.manager.analyze(app_id, title)
                    entry["issues"] = self.importer.issues(app_id, folder, state, analysis)
                    if state == "ERROR":
                        entry["issues"].insert(0, {"code": "error", "message": entry["error"] or "Terminó con error."})
                else:
                    entry["issues"] = []
        entry["standard"] = not entry["issues"]
        entry["reclaimable_bytes"] = sum(issue.get("bytes", 0) for issue in entry["issues"])
        entry["warning"] = entry["issues"][0]["message"] if entry["issues"] else ""
        return entry

    def _identify(self, folder: Path) -> tuple[int, str] | None:
        """The AppID a folder without it in its name declares (steam_emu.ini, OnlineFix.ini, steam_appid.txt...), when
        no other game of the library has it already."""
        from game_scanner import GameScanner
        try:
            declared = GameScanner()._measure(folder)[3]
        except OSError:
            return None
        if not declared:
            return None
        app_id = int(declared[0])
        taken = self.storage.linked.get(app_id) or any(
            p.resolve() != folder.resolve()
            for root in self.storage.roots if root.is_dir() for p in root.glob(f"{app_id}-*") if p.is_dir())
        return None if taken else (app_id, declared[1])

    def _rename_identified(self, app_id: int, folder: Path, name: str) -> None:
        """Give an identified folder its AppID in the name (<AppID>-<game>); adopting it then sets its status."""
        target = folder.parent / f"{int(app_id)}-{self.storage.folder_name(name)}"
        if target.exists():
            raise ValueError(ui("relocTaken", folder=str(folder.parent)))
        folder.rename(target)
        journal.note(target, "importado", f"identificado como AppID {app_id}; carpeta renombrada desde {folder.name}")
        self.log.info("AppID %s: misnamed folder %s renamed to %s", app_id, folder.name, target.name)

    def _steam_rows(self, linked_ids: set[int]) -> tuple[dict[int, dict], list[dict]]:
        """The owner of every Steam game, and a row for each owned Steam game that is not installed: Steam installs it."""
        if self.steam is None:
            return {}, []
        try:
            owners, owned = self.steam.library_rows(linked_ids)
        except (OSError, ValueError) as error:
            self.log.warning("Steam games not listed: %s", error)
            return {}, []
        hidden = self.storage.linked.hidden()
        rows = [{"app_id": item["app_id"], "name": item["name"], "state": "steam_owned", "folder": "", "linked": True,
                 "link_kind": "steam", "installed": False, "needs_repair": False, "error": "", "size_bytes": None, "issues": [],
                 "standard": True, "reclaimable_bytes": 0, "warning": "", "label": "", "plays": 0, "last_played": "",
                 "steam_owner": _owner(item)} for item in owned if item["app_id"] not in hidden]
        return owners, rows

    @staticmethod
    def _linked_size(record: dict, folder: Path, with_sizes: bool, steam_owner: dict | None) -> int | None:
        """A Steam game's size is in its manifest (walking hundreds of GB of Steam folders took most of a minute)."""
        if not with_sizes or not folder.is_dir():
            return None
        if record["kind"] == "steam" and steam_owner and steam_owner.get("size_bytes"):
            return int(steam_owner["size_bytes"])
        return folder_size(folder)

    def _linked_entry(self, record: dict, with_sizes: bool, steam_owner: dict | None = None) -> dict:
        """A game that stays where it is: always 'standard' (nothing about it is ours to fix), only launched and counted."""
        folder = Path(record["path"])
        status = self.storage.linked.status(record)
        entry = {"app_id": record["app_id"], "name": record["name"], "state": "linked", "folder": str(folder), "linked": True,
                 "link_kind": record["kind"], "installed": status["installed"], "needs_repair": False, "error": status.get("error", ""),
                 "size_bytes": self._linked_size(record, folder, with_sizes, steam_owner), "issues": [], "standard": True,
                 "reclaimable_bytes": 0, "warning": status.get("error", ""), "label": str(record.get("label") or ""),
                 **play_history(self.storage.linked.log_dir(record["app_id"]))}
        if record["kind"] == "steam" and steam_owner is not None:
            entry["steam_owner"] = _owner(steam_owner)
            if not status["installed"]:
                # Uninstalled from Steam: still owned, so it waits to be installed again through Steam.
                entry.update(state="steam_owned", error="", warning="")
                return entry
        if not status["installed"]:
            entry["issues"] = [{"code": "missing_link", "message": status["error"]}]
            entry["standard"] = False
        return entry

    def clean_empty(self) -> None:
        """Empty game folders and empty temporary downloads are deleted without asking: they hold nothing. A game folder
        whose download is unfinished stays: its record is where the download goes on from (source, step)."""
        unfinished = {item["app_id"] for item in self.storage.transfers()}
        for root in self.storage.roots:
            if not root.is_dir():
                continue
            for folder in sorted(root.iterdir()):
                app_id, _, state = split_folder_name(folder.name)
                if app_id is None or state not in (None, "ready", "ERROR") or not folder.is_dir() or folder.is_symlink():
                    continue
                if app_id in unfinished:
                    continue
                try:
                    if not any(self.storage.has_content(folder)):
                        self.storage.remove_empty(app_id, folder)
                        self.log.info("Empty folder removed: %s", folder.name)
                except (OSError, ValueError) as error:
                    self.log.error("Could not remove empty folder %s: %s", folder.name, error)
        for item in self.storage.transfers():
            if not item["active"] and folder_size(Path(item["folder"])) == 0:
                try:
                    self.storage.discard_transfer(item["app_id"])
                    self.log.info("Empty temporary download removed: %s", Path(item["folder"]).name)
                except (OSError, ValueError) as error:
                    self.log.error("Could not remove empty download %s: %s", item["folder"], error)

    def _merge_transfers(self, games: list[dict], with_sizes: bool) -> None:
        """One row per game: an unfinished download is part of its game's row, or a row of its own when the game is not installed."""
        by_id = {g["app_id"]: g for g in games if g["app_id"] is not None}
        queued = self.storage.queued_downloads()
        for item in self.storage.transfers():
            # What really arrived: a torrent's files have their full length from the start (sparse).
            size = allocated_size(Path(item["folder"])) if with_sizes else None
            row = by_id.get(item["app_id"])
            if row is not None:
                row["transfer_bytes"], row["transfer_active"], row["transfer_kind"] = size, item["active"], item["kind"]
                row["unfinished"] = True
                continue
            games.append({"app_id": item["app_id"], "name": item["name"], "state": "downloading" if item["active"] else "partial",
                          "folder": item["folder"], "installed": False, "needs_repair": False, "error": "", "size_bytes": 0,
                          "plays": 0, "last_played": "", "issues": [], "standard": True, "reclaimable_bytes": 0, "warning": "",
                          "transfer_bytes": size, "transfer_active": item["active"], "transfer_kind": item["kind"], "partial": True, "unfinished": True})
        for game in games:
            game.setdefault("transfer_bytes", 0)
            game.setdefault("transfer_active", False)
            game.setdefault("transfer_kind", "")
            # A folder still downloading or installing is also unfinished: nothing can be fixed until it ends.
            game["unfinished"] = bool(game.get("unfinished")) or game.get("state") in ("preparing", "downloading", "installing")
            # A download waiting in the queue (or paused before it wrote anything) is pending too: the folder must not be
            # fixed or marked ready until it ends.
            game["queued"] = game.get("app_id") in queued
            game["unfinished"] = game["unfinished"] or game["queued"]
            # Where a stopped download goes on (download, extract): the same point the Download Manager retries from.
            point = self.storage.resume_point(game["app_id"]) if game.get("app_id") is not None and not game.get("linked") else {}
            game["resume_step"] = point.get("step", "") if point.get("source") else ""
            if game["resume_step"] and not game.get("transfer_active"):
                game["unfinished"] = True

    def usage(self) -> dict:
        """Launches per day and per month across the whole library: feeds the usage charts and, later, the play-time limiter."""
        by_day: dict[str, int] = {}
        for folder in [*self.game_folders(), *self.storage.linked.log_dirs()]:
            for stamp in play_dates(folder):
                by_day[stamp[:10]] = by_day.get(stamp[:10], 0) + 1
        by_month: dict[str, int] = {}
        for day, count in by_day.items():
            by_month[day[:7]] = by_month.get(day[:7], 0) + count
        return {"by_day": dict(sorted(by_day.items())), "by_month": dict(sorted(by_month.items()))}

    def plan(self, app_ids: list[int]) -> list[dict]:
        """What fixing each game would do, for the user to review before anything runs."""
        listed = [g for g in self.list_games(with_sizes=False) if g["app_id"] is not None and not g.get("linked")]
        names = {g["app_id"]: g["name"] for g in listed}
        unfinished = {g["app_id"] for g in listed if g.get("unfinished")}
        misnamed = {g["app_id"]: g for g in listed if g.get("misnamed")}
        plans = []
        for app_id in dict.fromkeys(int(i) for i in app_ids):
            if app_id in misnamed:
                game = misnamed[app_id]
                standard = f"{app_id}-{self.storage.folder_name(game['name'])}"
                plans.append({"app_id": app_id, "name": game["name"], "freed_bytes": 0, "actions": [
                    {"code": "identify", "label": ui("libPlanIdentified", app_id=app_id, file=game["identified_by"])},
                    {"code": "rename", "label": ui("libPlanRename", folder=standard)},
                    {"code": "adopt", "label": ui("libPlanAdopt")}]})
            elif app_id in unfinished:
                plans.append({"app_id": app_id, "name": names[app_id], "actions": [], "error": UNFINISHED_MESSAGE})
            elif app_id in names:
                try:
                    plans.append(self.importer.plan(app_id, names[app_id]))
                except (OSError, ValueError) as error:
                    plans.append({"app_id": app_id, "name": names[app_id], "actions": [], "error": str(error)})
        return plans

    def transfers(self, with_sizes: bool = True) -> list[dict]:
        """Unfinished downloads in the temporary root, which also take disk space."""
        found = self.storage.transfers()
        for item in found:
            item["size_bytes"] = folder_size(Path(item["folder"])) if with_sizes else None
        return found

    def summary(self, games: list[dict] | None = None, transfers: list[dict] | None = None) -> dict:
        games = self.list_games() if games is None else games
        transfers = self.transfers() if transfers is None else transfers
        by_state: dict[str, int] = {}
        for game in games:
            by_state[game["state"]] = by_state.get(game["state"], 0) + 1
        disk = disk_info(self.storage.root)
        return {"count": sum(1 for g in games if not g.get("partial")), "by_state": by_state,
                "needs_repair": sum(1 for g in games if g["needs_repair"]),
                "nonstandard": sum(1 for g in games if not g["standard"]),
                "partial_downloads": sum(1 for g in games if g.get("partial") or (g.get("transfer_bytes") and not g.get("transfer_active"))),
                # What the games take on disk now: a frozen game counts its compressed size, and the saving is apart.
                "used_bytes": sum(on_disk_bytes(g) for g in games if not g.get("linked")),
                "frozen_saved_bytes": sum(max(0, (g["original_bytes"] or 0) - (g["frozen_bytes"] or 0)) for g in games
                                          if g.get("frozen") and g.get("frozen_bytes") is not None and not g.get("linked")),
                "linked_count": sum(1 for g in games if g.get("linked")),
                "linked_bytes": sum(g["size_bytes"] or 0 for g in games if g.get("linked")),
                "transfers_bytes": sum(t["size_bytes"] or 0 for t in transfers),
                "reclaimable_bytes": sum(g["reclaimable_bytes"] for g in games), **disk}

    # -- space check -------------------------------------------------------------------------
    def check_space(self, download_bytes: int, app_id: int = 0, name: str = "") -> dict:
        """Can this download and its unpacking fit? Called before any download starts. With the game's AppID, what an
        unfinished download of it already has on disk counts: resuming 94 of 104 GB needs room for the rest only."""
        temporary = Path(self.storage.preferences.load()["temporary_root"])
        transfer = self.storage.transfer_folder(int(app_id), name) if app_id else None
        if transfer is not None and transfer.is_dir():
            on_disk = allocated_size(transfer)
            room = check_download(download_bytes, on_disk, self.storage.root, temporary)
            self.log.info("Space for AppID %s: %s bytes, %s already on disk; %s", app_id, download_bytes, on_disk,
                          "fits" if room["ok"] else "does not fit")
        else:
            room = check_space(download_bytes, self.storage.root, temporary)
        if not room["ok"]:
            self.log.warning("Download refused (%s bytes): %s", download_bytes, room["message"])
        return room

    # -- history and connectors ------------------------------------------------------------------
    def history(self, app_id: int, name: str) -> str:
        return journal.read(self.storage.folder(app_id, name))

    # -- importing games that already exist elsewhere --------------------------------------------------
    def import_drives(self) -> list[dict]:
        return GameScanner.drives()

    def import_scan(self, drives: list[str], progress=lambda text: None, folders: list[str] = (), report=None) -> list[dict]:
        """Games found on the chosen disks and in the folders the player added that are not in the library yet."""
        known = [g["app_id"] for g in self.list_games(with_sizes=False) if g["app_id"] is not None]
        exclude = [*self.storage.roots, Path(self.storage.preferences.load()["temporary_root"])]
        return GameScanner(exclude=exclude, known_app_ids=known, progress=progress, report=report).scan(drives, list(folders))

    def relocate_plan(self, target: str) -> dict:
        from .relocate import LibraryRelocation
        return LibraryRelocation(self).plan(target)

    def relocate(self, app_id: int, target: str, mode: str) -> dict:
        from .relocate import LibraryRelocation
        try:
            return {"app_id": int(app_id), **LibraryRelocation(self).relocate(app_id, target, mode)}
        except (OSError, ValueError, RuntimeError) as error:
            self.log.error("Relocate AppID %s failed: %s", app_id, error)
            return {"app_id": int(app_id), "ok": False, "error": str(error)}

    def relocate_finish(self) -> dict:
        from .relocate import LibraryRelocation
        return LibraryRelocation(self).finish()

    def import_games(self, items: list[dict]) -> list[dict]:
        """Import each item {app_id, name, path, mode: link|move, kind, executable}; one failure never stops the rest."""
        results = []
        for item in items:
            try:
                results.append({"app_id": int(item["app_id"]), **self.importer.import_game(int(item["app_id"]), item["name"], item["path"], item.get("mode", "link"), item.get("kind", "folder"), item.get("executable", ""))})
            except (OSError, ValueError, RuntimeError, KeyError) as error:
                self.log.error("Import of %s failed: %s", item.get("name"), error)
                results.append({"app_id": item.get("app_id"), "ok": False, "error": str(error)})
        return results

    def steam_sync(self, refresh: bool = False, api_url: str = "") -> dict:
        """Link the installed Steam games that are not in the library (nor taken out of it by the user, nor already a
        Game Access game with the same AppID) and list the owned ones Steam can install."""
        if self.steam is None:
            return {"found": False, "linked": [], "owned": []}
        own = {split_folder_name(f.name)[0] for f in self.game_folders()}
        result = self.steam.sync(self.storage.linked, refresh, exclude=own | self.storage.linked.hidden(), api_url=api_url)
        result["owned"] = [item for item in result["owned"] if item["app_id"] not in own]
        return result

    def freeze(self, app_id: int, name: str, level: str = "freeze"):
        return (self.freezer.deep_freeze if level == "deep" else self.freezer.freeze)(app_id, name)

    def thaw(self, app_id: int, name: str):
        return self.freezer.thaw(app_id, name)

    def _steam_uninstall(self, app_id: int) -> dict:
        """A Steam game deleted from disk (its folder, manifest and leftovers); no Steam account is needed."""
        record = self.storage.linked.get(app_id)
        if self.steam is None or not record or record.get("kind") != "steam":
            return {"ok": False, "error": "No es un juego de Steam instalado."}
        try:
            return {"ok": True, **self.steam.uninstall(app_id, self.storage.linked)}
        except (OSError, ValueError, RuntimeError) as error:
            self.log.error("Steam uninstall AppID %s failed: %s", app_id, error)
            return {"ok": False, "error": str(error)}

    def _linked_folder_action(self, action: str, app_id: int) -> dict:
        """Delete or move a game linked from one of the player's folders. A Steam game is Steam's: neither."""
        record = self.storage.linked.get(app_id)
        if not record:
            return {"ok": False, "error": ui("linkedNotLinked")}
        if record.get("kind") != "folder":
            return {"ok": False, "error": ui("linkedIsSteam")}
        folder = Path(record["path"])
        try:
            if action == "linked_move":
                # The link goes first (the importer refuses a game that is still linked) and comes back on failure.
                self.storage.linked.unlink(app_id, hide=False)
                try:
                    outcome = self.importer.import_game(app_id, record["name"], str(folder), "move", "folder")
                except (OSError, ValueError, RuntimeError):
                    if folder.is_dir():
                        self.storage.linked.link(app_id, record["name"], str(folder), "folder", record.get("executable", ""))
                    raise
                if not outcome.get("ok", True) and folder.is_dir():
                    self.storage.linked.link(app_id, record["name"], str(folder), "folder", record.get("executable", ""))
                return {"ok": True, **outcome}
            keep = [*self.storage.roots, Path(self.storage.preferences.load()["temporary_root"]), self.storage.launcher,
                    *(Path(r["path"]) for r in self.storage.linked.all() if int(r["app_id"]) != int(app_id))]
            reason = deletable_reason(folder, keep)
            if reason:
                return {"ok": False, "error": reason}
            shutil.rmtree(folder)
            self.storage.linked.unlink(app_id, hide=False)
            self.log.info("AppID %s: linked folder deleted from disk: %s", app_id, folder)
            return {"ok": True, "deleted": str(folder)}
        except (OSError, ValueError, RuntimeError) as error:
            self.log.error("Linked %s AppID %s failed: %s", action, app_id, error)
            return {"ok": False, "error": str(error)}

    # -- batch ---------------------------------------------------------------------------------
    def batch(self, action: str, app_ids: list[int]) -> list[dict]:
        """Run one action on many games; one failure never stops the rest."""
        self.log.info("Batch %s on %s", action, list(app_ids))
        if action not in BATCH_ACTIONS:
            raise ValueError(f"Acción en lote no soportada: {action}")
        listed = [g for g in self.list_games(with_sizes=False) if g["app_id"] is not None]
        names = {g["app_id"]: g["name"] for g in listed}
        linked = {g["app_id"] for g in listed if g.get("linked")}
        steam_only = {g["app_id"] for g in listed if g.get("state") == "steam_owned" and not self.storage.linked.get(g["app_id"])}
        unfinished = {g["app_id"] for g in listed if g.get("unfinished")}
        misnamed = {g["app_id"]: Path(g["folder"]) for g in listed if g.get("misnamed")}
        results = []
        # A game being frozen or thawed is left alone until that ends.
        owner = freeze_holder(self.freezer.records)
        busy = int(owner["app_id"]) if owner else None
        for app_id in dict.fromkeys(int(i) for i in app_ids):
            name = names.get(app_id)
            if app_id == busy:
                results.append({"app_id": app_id, "ok": False, "error": "Se está congelando o descongelando: esperá a que termine o cancelalo."})
                continue
            if action == "steam_uninstall":
                results.append({"app_id": app_id, **self._steam_uninstall(app_id)})
                continue
            if action in ("linked_delete", "linked_move"):
                results.append({"app_id": app_id, **self._linked_folder_action(action, app_id)})
                continue
            if app_id in steam_only:
                if action == "uninstall":
                    self.storage.linked.hide(app_id)      # out of the library; Steam keeps the game
                    results.append({"app_id": app_id, "ok": True})
                else:
                    results.append({"app_id": app_id, "ok": False, "error": "Es un juego de Steam sin instalar: lo instala Steam."})
                continue
            if app_id in linked and action != "uninstall":
                results.append({"app_id": app_id, "ok": False, "error": "Es un juego vinculado: sus archivos no se modifican."})
                continue
            if name is None:
                results.append({"app_id": app_id, "ok": False, "error": "El juego no está en la biblioteca."})
                continue
            if action in ("adopt", "repair", "analyze") and self.freezer.is_deep(app_id):
                results.append({"app_id": app_id, "ok": False, "error": "Está en congelado profundo: descongelalo antes."})
                continue
            if app_id in unfinished and action in ("adopt", "repair"):
                results.append({"app_id": app_id, "ok": False, "error": UNFINISHED_MESSAGE})
                continue
            try:
                if action == "uninstall":
                    self.storage.uninstall(app_id, name)
                    self.freezer.forget(app_id)
                    results.append({"app_id": app_id, "ok": True})
                elif action == "discard_transfer":
                    self.storage.discard_transfer(app_id, game_folder=True)   # the player's "Discard": all of it
                    results.append({"app_id": app_id, "ok": True})
                elif action == "adopt":
                    if app_id in misnamed:
                        self._rename_identified(app_id, misnamed[app_id], name)
                    results.append({"app_id": app_id, **self.importer.adopt(app_id, name)})
                elif action == "repair":
                    outcome = self.manager.repair(app_id, name)
                    results.append({"app_id": app_id, **outcome})
                else:
                    results.append({"app_id": app_id, "ok": True, "analysis": self.manager.analyze(app_id, name)})
            except (OSError, ValueError, RuntimeError) as error:
                self.log.error("Batch %s AppID %s failed: %s", action, app_id, error)
                folder = _in_use(error)
                if folder:
                    # Windows will not rename or move a folder open in Explorer (or a console standing in it): say so
                    # plainly, and in the game's own log too, where the player looks first.
                    journal.note(folder, "error", f"{action}: la carpeta está abierta en otro programa (WinError {getattr(error, 'winerror', '')})")
                    results.append({"app_id": app_id, "ok": False, "error": ui("libFolderInUse", folder=str(folder))})
                else:
                    results.append({"app_id": app_id, "ok": False, "error": str(error)})
        self.log.info("Batch %s done: %s ok, %s failed", action, sum(1 for r in results if r.get("ok")), sum(1 for r in results if not r.get("ok")))
        return results
