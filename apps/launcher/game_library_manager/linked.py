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
        return record

    def unlink(self, app_id: int) -> None:
        """Forget the link and its history. The game itself is never touched."""
        (self.dir / f"{int(app_id)}.json").unlink(missing_ok=True)

    def log_dir(self, app_id: int) -> Path:
        return self.dir / "logs" / str(int(app_id))

    def log_dirs(self) -> list[Path]:
        return [self.log_dir(r["app_id"]) for r in self.all() if self.log_dir(r["app_id"]).is_dir()]

    def status(self, record: dict) -> dict:
        folder = Path(record["path"])
        present = folder.is_dir()
        return {"folder": str(folder), "installed": present, "state": "linked", "linked": True, "link_kind": record["kind"],
                "needs_repair": False, **({} if present else {"error": "La carpeta vinculada ya no existe."})}


def run_linked(action: str, record: dict, linked: LinkedGames, logger, find_candidates=None) -> dict:
    """The few things that can be done with a linked game; nothing here writes inside its folder."""
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
            os.startfile(f"steam://rungameid/{app_id}")
            linked.log_dir(app_id).mkdir(parents=True, exist_ok=True)
            journal.note(linked.log_dir(app_id), "play", "lanzado: Steam")
            return {"command": f"steam://rungameid/{app_id}"}
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
