"""Linked games: games that stay where they are (a Steam library, an old games folder).

Game Access only launches them and counts their plays. It never renames, moves, writes into or deletes their
folder: the record and the play history live under `.cache/digital_linked`, outside the game."""
from __future__ import annotations
import json
import os
import subprocess
import sys
from pathlib import Path
from atomic_json import write_json
from launcher_data import data_dir
import game_journal as journal
from game_download_manager.ui_text import ui

KINDS = ("steam", "folder")


class LinkedGames:
    def __init__(self, launcher: Path):
        self.dir = data_dir(launcher) / ".cache" / "digital_linked"

    def get(self, app_id: int) -> dict | None:
        record = self.dir / f"{int(app_id)}.json"
        if not record.is_file():
            return None
        try:
            return json.loads(record.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def all(self) -> list[dict]:
        if not self.dir.is_dir():
            return []
        found = [self.get(int(p.stem)) for p in sorted(self.dir.glob("*.json")) if p.stem.isdigit()]
        return [r for r in found if r]

    def link(self, app_id: int, name: str, path: str, kind: str = "folder", executable: str = "") -> dict:
        if kind not in KINDS:
            raise ValueError("Tipo de vínculo desconocido.")
        folder = Path(path)
        if not folder.is_dir():
            raise ValueError("La carpeta del juego no existe.")
        record = {"app_id": int(app_id), "name": name, "path": str(folder.resolve()), "kind": kind, "executable": executable}
        self.dir.mkdir(parents=True, exist_ok=True)
        write_json(self.dir / f"{int(app_id)}.json", record)
        self.log_dir(app_id).mkdir(parents=True, exist_ok=True)
        journal.note(self.log_dir(app_id), "vinculado", f"{kind}: {record['path']}")
        self.unhide(app_id)
        return record

    def unlink(self, app_id: int, hide: bool = True) -> None:
        """Forget the link and its history. The game itself is never touched. A Steam game the user takes out of the
        library is remembered as hidden, so the automatic Steam import does not bring it back (`hide=False` after an
        uninstall: the game is gone from disk, and an owned one stays offered to install again)."""
        record = self.get(app_id)
        (self.dir / f"{int(app_id)}.json").unlink(missing_ok=True)
        if hide and record and record.get("kind") == "steam":
            self.hide(app_id)

    # -- Steam games the user took out of the library ---------------------------------------------------
    def hidden(self) -> set[int]:
        try:
            return {int(i) for i in json.loads((self.dir / "steam_hidden.json").read_text(encoding="utf-8"))}
        except (OSError, ValueError, TypeError):
            return set()

    def hide(self, app_id: int) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        write_json(self.dir / "steam_hidden.json", sorted(self.hidden() | {int(app_id)}))

    def unhide(self, app_id: int) -> None:
        if int(app_id) in self.hidden():
            write_json(self.dir / "steam_hidden.json", sorted(self.hidden() - {int(app_id)}))

    def log_dir(self, app_id: int) -> Path:
        return self.dir / "logs" / str(int(app_id))

    def log_dirs(self) -> list[Path]:
        return [self.log_dir(r["app_id"]) for r in self.all() if self.log_dir(r["app_id"]).is_dir()]

    def status(self, record: dict) -> dict:
        folder = Path(record["path"])
        present = folder.is_dir()
        return {"folder": str(folder), "installed": present, "state": "linked", "linked": True, "link_kind": record["kind"],
                "needs_repair": False, **({} if present else {"error": "La carpeta vinculada ya no existe."})}


def protected_folders() -> list[Path]:
    """Folders a linked game can never be: deleting one would take Windows, programs or the user's own files with it."""
    env = os.environ
    names = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "USERPROFILE", "PUBLIC", "APPDATA", "LOCALAPPDATA"]
    found = [Path(env[name]) for name in names if env.get(name)]
    home = Path(env["USERPROFILE"]) if env.get("USERPROFILE") else Path.home()
    found += [home / part for part in ("Desktop", "Documents", "Downloads", "Music", "Pictures", "Videos", "OneDrive")]
    return [p.resolve() for p in found]


def deletable_reason(folder: Path, keep: list[Path] = ()) -> str:
    """Why this linked folder must not be deleted as a whole, or "" when it can: a game's own folder, never a disk,
    a system or user folder, one that holds those, a games or downloads root of Game Access, nor one with links inside
    (deleting through a link would reach files outside it)."""
    folder = Path(folder)
    if not folder.is_dir():
        return ui("linkedFolderGone")
    resolved = folder.resolve()
    if resolved == Path(resolved.anchor):
        return ui("linkedDiskRoot")
    for other in [*protected_folders(), *(Path(k).resolve() for k in keep)]:
        if resolved == other or other.is_relative_to(resolved):
            return ui("linkedProtected", folder=str(other))
    for item in [folder, *folder.rglob("*")]:
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            return ui("linkedHasLinks")
    return ""


def run_linked(action: str, record: dict, linked: LinkedGames, logger, find_candidates=None, steam=None) -> dict:
    """The few things that can be done with a linked game; nothing here writes inside its folder. A Steam game is run
    by Steam, signed in to the account that owns it (`steam`: the Steam Account Manager)."""
    app_id, folder = record["app_id"], Path(record["path"])
    if action == "status":
        return linked.status(record)
    if action == "uninstall":
        linked.unlink(app_id)
        logger.info("AppID %s: link removed; the game's files were not touched (%s)", app_id, folder)
        return {"exit_code": 0, "unlinked": True}
    if action == "open-folder":
        if not folder.is_dir():
            raise ValueError("No existe la carpeta del juego.")
        os.startfile(str(folder))
        return {}
    if action == "game-log":
        return {"log": journal.read(linked.log_dir(app_id))}
    if action == "game-analyze":
        return {"analysis": {"state": "ready", "ready": True, "warning": "", "needs": [], "executable": record.get("executable", "")}}
    if action == "game-repair":
        return {"ok": True}
    if action == "play":
        if not folder.is_dir():
            raise ValueError("La carpeta vinculada ya no existe.")
        if record["kind"] == "steam":
            if steam is not None:
                outcome = steam.play(app_id)
            else:
                os.startfile(f"steam://rungameid/{app_id}")
                outcome = {"command": f"steam://rungameid/{app_id}"}
            linked.log_dir(app_id).mkdir(parents=True, exist_ok=True)
            owner = outcome.get("steam_owner")
            journal.note(linked.log_dir(app_id), "play", f"lanzado: Steam{f' ({owner})' if owner else ''}")
            return outcome
        exe = Path(record["executable"]) if record.get("executable") else None
        if not exe or not exe.is_file():
            candidates = find_candidates(folder, record["name"]) if find_candidates else []
            exe = candidates[0][0] if candidates else None
        if exe is None:
            raise ValueError("No se encontró el ejecutable del juego vinculado.")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008 if sys.platform == "win32" else 0
        process = subprocess.Popen([str(exe)], cwd=str(exe.parent), creationflags=flags, close_fds=True)
        journal.note(linked.log_dir(app_id), "play", f"lanzado: {exe.name} (pid {process.pid})")
        logger.info("AppID %s: linked game launched; executable=%s; pid=%s", app_id, exe, process.pid)
        return {"pid": process.pid, "command": str(exe)}
    raise ValueError("Esta acción no está disponible para juegos vinculados: sus archivos no se modifican.")
