"""Game Library Manager: governs the library as a whole.

How many games there are, the state of each, the disk space each folder takes, free space and
whether a download (and its extraction) fits, batch actions, and connectors to the other modules:

    GameExecutionManager  -> analyze / repair a game          (game_execution_manager)
    game_journal          -> per-game history and play counts (game_journal)
    GameImporter          -> bring games from outside the catalog (not implemented yet)
    Freezer               -> compress rarely used games         (not implemented yet)

Pure Python, no UI: the desktop screen and any future module (play-time limiter, importer) call it."""
from __future__ import annotations
from pathlib import Path
import game_journal as journal
from game_execution_manager import GameExecutionManager
from .disk import check_space, disk_info, folder_size
from .storage import split_folder_name

BATCH_ACTIONS = ("uninstall", "repair", "analyze")


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
        self.importer = importer
        self.freezer = freezer

    # -- inventory -------------------------------------------------------------------------
    def game_folders(self) -> list[Path]:
        found = []
        for root in self.storage.roots:
            if root.is_dir():
                found += [p for p in sorted(root.iterdir()) if p.is_dir() and split_folder_name(p.name)[0] is not None]
        return found

    def list_games(self, with_sizes: bool = True) -> list[dict]:
        games = []
        for folder in self.game_folders():
            app_id, title, state = split_folder_name(folder.name)
            status = self.storage.status(app_id, title)
            entry = {"app_id": app_id, "name": title, "state": state or "legacy", "folder": str(folder),
                     "installed": bool(status.get("installed")), "needs_repair": bool(status.get("needs_repair")),
                     "error": status.get("error", ""), "size_bytes": folder_size(folder) if with_sizes else None,
                     **play_history(folder)}
            if state == "ready" and not entry["needs_repair"]:
                entry["warning"] = ""
            else:
                entry["warning"] = entry["error"] or (self.manager.analyze(app_id, title)["warning"] if entry["needs_repair"] else "")
            games.append(entry)
        return games

    def summary(self, games: list[dict] | None = None) -> dict:
        games = self.list_games() if games is None else games
        by_state: dict[str, int] = {}
        for game in games:
            by_state[game["state"]] = by_state.get(game["state"], 0) + 1
        disk = disk_info(self.storage.root)
        return {"count": len(games), "by_state": by_state,
                "needs_repair": sum(1 for g in games if g["needs_repair"]),
                "used_bytes": sum(g["size_bytes"] or 0 for g in games), **disk}

    # -- space check -------------------------------------------------------------------------
    def check_space(self, download_bytes: int) -> dict:
        """Can this download and its unpacking fit? Called before any download starts."""
        return check_space(download_bytes, self.storage.root, Path(self.storage.preferences.load()["temporary_root"]))

    # -- history and connectors ------------------------------------------------------------------
    def history(self, app_id: int, name: str) -> str:
        return journal.read(self.storage.folder(app_id, name))

    def import_game(self, source: str, name: str = ""):
        if self.importer is None:
            raise NotImplementedError("La importación de juegos todavía no está disponible.")
        return self.importer.import_game(source, name, self)

    def freeze(self, app_id: int, name: str):
        if self.freezer is None:
            raise NotImplementedError("El congelador de juegos todavía no está disponible.")
        return self.freezer.freeze(app_id, name)

    # -- batch ---------------------------------------------------------------------------------
    def batch(self, action: str, app_ids: list[int]) -> list[dict]:
        """Run one action on many games; one failure never stops the rest."""
        if action not in BATCH_ACTIONS:
            raise ValueError(f"Acción en lote no soportada: {action}")
        names = {g["app_id"]: g["name"] for g in self.list_games(with_sizes=False)}
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
                elif action == "repair":
                    outcome = self.manager.repair(app_id, name)
                    results.append({"app_id": app_id, **outcome})
                else:
                    results.append({"app_id": app_id, "ok": True, "analysis": self.manager.analyze(app_id, name)})
            except (OSError, ValueError, RuntimeError) as error:
                results.append({"app_id": app_id, "ok": False, "error": str(error)})
        return results
