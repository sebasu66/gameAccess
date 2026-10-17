"""Game Library Manager: governs the library as a whole.

How many games there are, the state of each, the disk space each folder takes, free space and
whether a download (and its extraction) fits, batch actions, and connectors to the other modules:

    GameExecutionManager  -> analyze / repair a game          (game_execution_manager)
    game_journal          -> per-game history and play counts (game_journal)
    GameImporter          -> bring a folder up to the standard (adopt); import from outside later (game_importer)
    Freezer               -> compress rarely used games         (not implemented yet)

Pure Python, no UI: the desktop screen and any future module (play-time limiter, importer) call it."""
from __future__ import annotations
from pathlib import Path
import game_journal as journal
import app_log
from game_execution_manager import GameExecutionManager
from disk_space import check_space, disk_info, folder_size
from game_importer import GameImporter
from .storage import split_folder_name

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


class GameLibraryManager:
    def __init__(self, storage, manager=None, importer=None, freezer=None):
        self.storage = storage
        self.manager = manager or GameExecutionManager(storage)
        self.log = app_log.manager_logger("library")
        self.importer = importer or GameImporter(storage, self.manager)
        self.freezer = freezer

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
        for item in self.storage.transfers():
            size = folder_size(Path(item["folder"])) if with_sizes else None
            row = by_id.get(item["app_id"])
            if row is not None:
                row["transfer_bytes"], row["transfer_active"] = size, item["active"]
                continue
            games.append({"app_id": item["app_id"], "name": item["name"], "state": "downloading" if item["active"] else "partial",
                          "folder": item["folder"], "installed": False, "needs_repair": False, "error": "", "size_bytes": 0,
                          "plays": 0, "last_played": "", "issues": [], "standard": True, "reclaimable_bytes": 0, "warning": "",
                          "transfer_bytes": size, "transfer_active": item["active"], "partial": True})
        for game in games:
            game.setdefault("transfer_bytes", 0)
            game.setdefault("transfer_active", False)

    def usage(self) -> dict:
        """Launches per day and per month across the whole library: feeds the usage charts and, later, the play-time limiter."""
        by_day: dict[str, int] = {}
        for folder in self.game_folders():
            for stamp in play_dates(folder):
                by_day[stamp[:10]] = by_day.get(stamp[:10], 0) + 1
        by_month: dict[str, int] = {}
        for day, count in by_day.items():
            by_month[day[:7]] = by_month.get(day[:7], 0) + count
        return {"by_day": dict(sorted(by_day.items())), "by_month": dict(sorted(by_month.items()))}

    def plan(self, app_ids: list[int]) -> list[dict]:
        """What fixing each game would do, for the user to review before anything runs."""
        names = {g["app_id"]: g["name"] for g in self.list_games(with_sizes=False) if g["app_id"] is not None}
        plans = []
        for app_id in dict.fromkeys(int(i) for i in app_ids):
            if app_id in names:
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
                "used_bytes": sum(g["size_bytes"] or 0 for g in games),
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

    def import_game(self, source: str, name: str = ""):
        return self.importer.import_game(source, name)

    def freeze(self, app_id: int, name: str):
        if self.freezer is None:
            raise NotImplementedError("El congelador de juegos todavía no está disponible.")
        return self.freezer.freeze(app_id, name)

    # -- batch ---------------------------------------------------------------------------------
    def batch(self, action: str, app_ids: list[int]) -> list[dict]:
        """Run one action on many games; one failure never stops the rest."""
        self.log.info("Batch %s on %s", action, list(app_ids))
        if action not in BATCH_ACTIONS:
            raise ValueError(f"Acción en lote no soportada: {action}")
        names = {g["app_id"]: g["name"] for g in self.list_games(with_sizes=False) if g["app_id"] is not None}
        results = []
        for app_id in dict.fromkeys(int(i) for i in app_ids):
            name = names.get(app_id)
            if name is None:
                results.append({"app_id": app_id, "ok": False, "error": "El juego no está en la biblioteca."})
                continue
            try:
                if action == "uninstall":
                    self.storage.uninstall(app_id, name)
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
