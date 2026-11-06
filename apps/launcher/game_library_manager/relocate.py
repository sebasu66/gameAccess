"""One games folder: when the player changes it, the games in the old one move to the new one (the default) or stay
where they are, linked (then each can be moved later from the Library Manager, "Move to the games folder").

The order keeps every game visible at every moment, even if the app closes halfway: the new folder is saved first
(the old one stays listed among `previous_roots`), the games are moved or linked one by one, and only then the
old folders that no longer hold a game of ours leave the list (DigitalPreferences.save with `relocated`)."""
from __future__ import annotations
import shutil
from pathlib import Path
import game_journal as journal
from atomic_json import write_json
from disk_space import GIB, disk_info, folder_size
from game_paths import fits, longest_inside
from .freeze_control import holder as freeze_holder
from game_download_manager.ui_text import ui


def _same_disk(a: Path, b: Path) -> bool:
    return Path(a).resolve().drive.lower() == Path(b).resolve().drive.lower()


class LibraryRelocation:
    def __init__(self, library):
        self.library = library
        self.storage = library.storage

    def _outside(self, target: Path) -> list[dict]:
        """Our games (not linked, not only owned on Steam) whose folder is not in `target`."""
        return [g for g in self.library.list_games(with_sizes=False)
                if g.get("app_id") is not None and not g.get("linked") and g.get("state") != "steam_owned"
                and g.get("folder") and Path(g["folder"]).parent.resolve() != target]

    def plan(self, target: str) -> dict:
        """What moving the library to `target` involves: each game (size, same disk, whether its deepest file fits the
        path limit there, whether that folder name is taken, whether it must move because it cannot be linked), the
        bytes to copy to another disk and the room there."""
        root = Path(target).resolve()
        games = []
        for game in self._outside(root):
            folder = Path(game["folder"])
            size = folder_size(folder) if folder.is_dir() else 0
            deep = self.library.freezer.is_deep(int(game["app_id"]))
            games.append({"app_id": game["app_id"], "name": game["name"], "folder": str(folder), "size_bytes": size,
                          "same_disk": _same_disk(folder, root), "fits": fits(root / folder.name, longest_inside(folder)),
                          "taken": any(root.glob(f"{int(game['app_id'])}-*")) if root.is_dir() else False,
                          # An unfinished download or a deep-frozen game only works from the games folder: it moves.
                          "must_move": bool(game.get("unfinished")) or deep or game.get("state") not in ("ready", "legacy", None)})
        copy_bytes = sum(g["size_bytes"] for g in games if not g["same_disk"])
        free = disk_info(root)["disk_free_bytes"]
        return {"target": str(root), "games": games, "copy_bytes": copy_bytes, "free_bytes": free,
                "room": free >= copy_bytes + GIB}

    def finish(self) -> dict:
        """After the moves: the old folders still holding a game of ours that is not linked (one that failed to move)
        stay listed so it remains visible; the rest leave the list."""
        from .preferences import DigitalPreferences
        from .storage import split_folder_name
        linked = {Path(r["path"]).resolve() for r in self.storage.linked.all()}
        keep = [str(root) for root in self.storage.roots[1:] if root.is_dir() and any(
            p.is_dir() and split_folder_name(p.name)[0] is not None and p.resolve() not in linked for p in root.iterdir())]
        preferences = DigitalPreferences(self.storage.launcher)
        settings = preferences.save({**preferences.load(), "previous_roots": keep, "relocated": True})
        return {"ok": True, "settings": settings, "left": keep}

    def relocate(self, app_id: int, target: str, mode: str) -> dict:
        """Move one game into `target` ("move") or link it where it is ("link"); a game that must move always moves."""
        root = Path(target).resolve()
        game = next((g for g in self._outside(root) if int(g["app_id"]) == int(app_id)), None)
        if game is None:
            return {"ok": True, "already": True}
        owner = freeze_holder(self.library.freezer.records)
        if owner and int(owner["app_id"]) == int(app_id):
            return {"ok": False, "error": ui("relocFreezing")}
        if game.get("transfer_active"):
            return {"ok": False, "error": ui("relocDownloading")}
        folder = Path(game["folder"])
        record = self.storage._record(app_id)
        name = record.get("name") or game["name"]
        deep = self.library.freezer.is_deep(int(app_id))
        must_move = bool(game.get("unfinished")) or deep or game.get("state") not in ("ready", "legacy", None)
        if mode == "link" and not must_move:
            label = self.storage.label(app_id)
            self.storage.linked.link(app_id, name, str(folder), "folder")
            if label:
                self.storage.set_label(app_id, name, label)
            # The game is now a linked one: its install record and freeze record would list it twice.
            (self.storage.registry / f"{int(app_id)}.json").unlink(missing_ok=True)
            self.library.freezer.forget(app_id)
            journal.note(self.storage.linked.log_dir(app_id), "vinculado", f"la carpeta de juegos cambió a {root}; el juego quedó en {folder}")
            return {"ok": True, "mode": "link"}
        destination = root / folder.name
        if destination.exists() or any(root.glob(f"{int(app_id)}-*")):
            return {"ok": False, "error": ui("relocTaken", folder=str(root))}
        if not fits(destination, longest_inside(folder)):
            return {"ok": False, "error": ui("relocTooLong")}
        size = folder_size(folder)
        if not _same_disk(folder, root) and disk_info(root)["disk_free_bytes"] < size + GIB:
            return {"ok": False, "error": ui("relocNoRoom")}
        root.mkdir(parents=True, exist_ok=True)
        shutil.move(str(folder), str(destination))   # a rename on the same disk; a copy and delete to another one
        if record:
            write_json(self.storage.registry / f"{int(app_id)}.json", {**record, "folder": str(destination)})
        frozen = self.library.freezer.record(app_id)
        if frozen and Path(frozen.get("folder", "")) == folder:
            write_json(self.library.freezer.records / f"{int(app_id)}.json", {**frozen, "folder": str(destination)})
        journal.note(destination, "movido", f"desde {folder}: la carpeta de juegos cambió a {root}")
        return {"ok": True, "mode": "move", "folder": str(destination)}
