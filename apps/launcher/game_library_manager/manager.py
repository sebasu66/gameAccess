"""Game Library Manager: governs the library as a whole.

How many games there are, the state of each, the disk space each folder takes, free space and
whether a download (and its extraction) fits, batch actions, and connectors to the other modules:

    GameExecutionManager  -> analyze / repair a game          (game_execution_manager)
    game_journal          -> per-game history and play counts (game_journal)
    GameImporter          -> bring a folder up to the standard (adopt); import from outside later (game_importer)
    GameFreezer           -> compress rarely used games, two levels (freezer.py)

Pure Python, no UI: the desktop screen and any future module (play-time limiter, importer) call it."""
from __future__ import annotations
from pathlib import Path
import game_journal as journal
import app_log
from game_execution_manager import GameExecutionManager
from disk_space import check_space, disk_info, folder_size
from game_importer import GameImporter
from game_scanner import GameScanner
from .storage import split_folder_name
from .freezer import GameFreezer

BATCH_ACTIONS = ("uninstall", "repair", "analyze", "adopt", "discard_transfer")


def play_dates(folder: Path) -> list[str]:
    """Timestamps ('YYYY-MM-DD HH:MM:SS') of every launch recorded in the game's log."""
    found = []
    for line in journal.read(folder).splitlines():
        parts = line.split(" | ", 2)
        if len(parts) == 3 and parts[1] == "play" and parts[2].startswith("lanzado"):
            found.append(parts[0])
    return found


def play_history(folder: Path) -> dict:
    """Play count and last launch, read from the game's own log (the future play-time limiter links here)."""
    plays, last = 0, ""
    for line in journal.read(folder).splitlines():
        parts = line.split(" | ", 2)
        if len(parts) == 3 and parts[1] == "play" and parts[2].startswith("lanzado"):
            plays += 1
            last = parts[0]
    return {"plays": plays, "last_played": last}


UNFINISHED_MESSAGE = "La descarga no terminó: primero hay que completarla (o descartarla) antes de corregir la carpeta."


class GameLibraryManager:
    def __init__(self, storage, manager=None, importer=None, freezer=None):
        self.storage = storage
        self.manager = manager or GameExecutionManager(storage)
        self.log = app_log.manager_logger("library")
        self.importer = importer or GameImporter(storage, self.manager)
        self.freezer = freezer or GameFreezer(storage, self.log)

    # -- inventory -------------------------------------------------------------------------
    def game_folders(self) -> list[Path]:
        found = []
        for root in self.storage.roots:
            if root.is_dir():
                found += [p for p in sorted(root.iterdir()) if p.is_dir() and split_folder_name(p.name)[0] is not None]
        return found

    def list_games(self, with_sizes: bool = True) -> list[dict]:
        """The scan: every folder in the games roots with its state, size and what keeps it from the standard."""
        self.clean_empty()
        games = []
        for root in self.storage.roots:
            if not root.is_dir():
                continue
            for folder in sorted(root.iterdir()):
                if folder.is_dir() and not folder.is_symlink():
                    games.append(self._entry(folder, with_sizes))
        games += [self._linked_entry(record, with_sizes) for record in self.storage.linked.all()]
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

    def _linked_entry(self, record: dict, with_sizes: bool) -> dict:
        """A game that stays where it is: always 'standard' (nothing about it is ours to fix), only launched and counted."""
        folder = Path(record["path"])
        status = self.storage.linked.status(record)
        entry = {"app_id": record["app_id"], "name": record["name"], "state": "linked", "folder": str(folder), "linked": True,
                 "link_kind": record["kind"], "installed": status["installed"], "needs_repair": False, "error": status.get("error", ""),
                 "size_bytes": folder_size(folder) if with_sizes and folder.is_dir() else None, "issues": [], "standard": True,
                 "reclaimable_bytes": 0, "warning": status.get("error", ""), "label": str(record.get("label") or ""),
                 **play_history(self.storage.linked.log_dir(record["app_id"]))}
        if not status["installed"]:
            entry["issues"] = [{"code": "missing_link", "message": status["error"]}]
            entry["standard"] = False
        return entry

    def clean_empty(self) -> None:
        """Empty game folders and empty temporary downloads are deleted without asking: they hold nothing."""
        for root in self.storage.roots:
            if not root.is_dir():
                continue
            for folder in sorted(root.iterdir()):
                app_id, _, state = split_folder_name(folder.name)
                if app_id is None or state not in (None, "ready", "ERROR") or not folder.is_dir() or folder.is_symlink():
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
            size = folder_size(Path(item["folder"])) if with_sizes else None
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
        plans = []
        for app_id in dict.fromkeys(int(i) for i in app_ids):
            if app_id in unfinished:
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
                "used_bytes": sum(g["size_bytes"] or 0 for g in games if not g.get("linked")),
                "linked_count": sum(1 for g in games if g.get("linked")),
                "linked_bytes": sum(g["size_bytes"] or 0 for g in games if g.get("linked")),
                "transfers_bytes": sum(t["size_bytes"] or 0 for t in transfers),
                "reclaimable_bytes": sum(g["reclaimable_bytes"] for g in games), **disk}

    # -- space check -------------------------------------------------------------------------
    def check_space(self, download_bytes: int) -> dict:
        """Can this download and its unpacking fit? Called before any download starts."""
        room = check_space(download_bytes, self.storage.root, Path(self.storage.preferences.load()["temporary_root"]))
        if not room["ok"]:
            self.log.warning("Download refused (%s bytes): %s", download_bytes, room["message"])
        return room

    # -- history and connectors ------------------------------------------------------------------
    def history(self, app_id: int, name: str) -> str:
        return journal.read(self.storage.folder(app_id, name))

    # -- importing games that already exist elsewhere --------------------------------------------------
    def import_drives(self) -> list[dict]:
        return GameScanner.drives()

    def import_scan(self, drives: list[str], progress=lambda text: None) -> list[dict]:
        """Games found on the chosen disks that are not in the library yet."""
        known = [g["app_id"] for g in self.list_games(with_sizes=False) if g["app_id"] is not None]
        exclude = [*self.storage.roots, Path(self.storage.preferences.load()["temporary_root"])]
        return GameScanner(exclude=exclude, known_app_ids=known, progress=progress).scan(drives)

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

    def freeze(self, app_id: int, name: str, level: str = "freeze"):
        return (self.freezer.deep_freeze if level == "deep" else self.freezer.freeze)(app_id, name)

    def thaw(self, app_id: int, name: str):
        return self.freezer.thaw(app_id, name)

    # -- batch ---------------------------------------------------------------------------------
    def batch(self, action: str, app_ids: list[int]) -> list[dict]:
        """Run one action on many games; one failure never stops the rest."""
        self.log.info("Batch %s on %s", action, list(app_ids))
        if action not in BATCH_ACTIONS:
            raise ValueError(f"Acción en lote no soportada: {action}")
        listed = [g for g in self.list_games(with_sizes=False) if g["app_id"] is not None]
        names = {g["app_id"]: g["name"] for g in listed}
        linked = {g["app_id"] for g in listed if g.get("linked")}
        unfinished = {g["app_id"] for g in listed if g.get("unfinished")}
        results = []
        for app_id in dict.fromkeys(int(i) for i in app_ids):
            name = names.get(app_id)
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
                    self.storage.discard_transfer(app_id)
                    results.append({"app_id": app_id, "ok": True})
                elif action == "adopt":
                    results.append({"app_id": app_id, **self.importer.adopt(app_id, name)})
                elif action == "repair":
                    outcome = self.manager.repair(app_id, name)
                    results.append({"app_id": app_id, **outcome})
                else:
                    results.append({"app_id": app_id, "ok": True, "analysis": self.manager.analyze(app_id, name)})
            except (OSError, ValueError, RuntimeError) as error:
                self.log.error("Batch %s AppID %s failed: %s", action, app_id, error)
                results.append({"app_id": app_id, "ok": False, "error": str(error)})
        self.log.info("Batch %s done: %s ok, %s failed", action, sum(1 for r in results if r.get("ok")), sum(1 for r in results if not r.get("ok")))
        return results
