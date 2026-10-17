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
        games = []
        for root in self.storage.roots:
            if not root.is_dir():
                continue
            for folder in sorted(root.iterdir()):
                if folder.is_dir() and not folder.is_symlink():
                    games.append(self._entry(folder, with_sizes))
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
        return {"count": len(games), "by_state": by_state,
                "needs_repair": sum(1 for g in games if g["needs_repair"]),
                "nonstandard": sum(1 for g in games if not g["standard"]),
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
        if action == "discard_transfer":
            names = {t["app_id"]: t["name"] for t in self.storage.transfers()}
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
