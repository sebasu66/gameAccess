"""Game Importer: brings a game folder up to the current standard.

For a game that never came through the catalog download (or predates the standard): the folder is
already unpacked (or half so), has no status suffix, no log, maybe a full-size backup archive that
duplicates the game. `adopt` fixes that; its log simply starts at the moment it was imported.
Importing from a path outside the games folder (copy/move, AppID lookup) will build on `adopt`."""
from __future__ import annotations
from pathlib import Path
import game_journal as journal
import app_log
from game_execution_manager.archives import is_backup_name
from game_execution_manager.execution_profile import declared_fix_archive, load_profile
from disk_space import GIB, check_space, folder_size

# A real fix archive is small; one this big is the downloaded game kept next to its own unpacked copy.
OBSOLETE_BACKUP_BYTES = 1 * GIB
BACKUP_MARKER = ".digital-backup.json"


def obsolete_backups(launcher, app_id: int, folder: Path) -> list[Path]:
    """Backup files that only duplicate the game: big, and not the fix the profile asks to re-apply."""
    kept = declared_fix_archive(load_profile(launcher, app_id))
    found = [p for p in Path(folder).iterdir() if p.is_file() and not p.is_symlink() and is_backup_name(p.name) and p.name != BACKUP_MARKER]
    big = [p for p in found if p.stat().st_size >= OBSOLETE_BACKUP_BYTES and p.name != kept]
    return big


class GameImporter:
    def __init__(self, storage, manager):
        self.storage = storage
        self.manager = manager
        self.log = app_log.manager_logger("importer")

    def issues(self, app_id: int | None, folder: Path, state: str | None, analysis: dict | None, size_of=None) -> list[dict]:
        """What keeps this folder from being standard: [{code, message, bytes?}]."""
        found = []
        if app_id is None:
            return [{"code": "bad_name", "message": "El nombre de la carpeta no sigue el formato <AppID>-<juego>-<estado>."}]
        if analysis and analysis["state"] == "empty":
            return [{"code": "empty", "message": "La carpeta está vacía."}]
        if analysis and not analysis["ready"]:
            found.append({"code": analysis["state"], "message": analysis["warning"]})
        if state is None:
            found.append({"code": "no_status", "message": "Carpeta con formato anterior: no tiene estado en el nombre."})
        if not (folder / journal.JOURNAL_FILE).is_file():
            found.append({"code": "no_log", "message": "No tiene registro de historial."})
        if analysis and analysis["ready"]:
            duplicated = obsolete_backups(self.storage.launcher, app_id, folder)
            if duplicated:
                total = sum(p.stat().st_size for p in duplicated)
                found.append({"code": "obsolete_backup", "message": "Guarda una copia comprimida que duplica el juego entero.", "bytes": total})
        return found

    def import_game(self, source: str, name: str = ""):
        raise NotImplementedError("Importar desde otra carpeta todavía no está disponible; por ahora se adaptan las carpetas que ya están en la biblioteca.")

    def adopt(self, app_id: int, name: str, progress=lambda text: None) -> dict:
        folder = self.storage.folder(app_id, name)
        self.log.info("AppID %s (%s): adopting %s", app_id, name, folder.name)
        if not folder.is_dir() or not any(self.storage.has_content(folder)):
            if folder.is_dir():
                self.storage.remove_empty(app_id, folder)
                self.log.info("AppID %s: empty folder removed", app_id)
            return {"ok": True, "removed_empty": True}
        if not (folder / journal.JOURNAL_FILE).is_file():
            journal.note(folder, "importado", "carpeta adaptada al estándar actual; el historial de descarga anterior no está disponible")
        analysis = self.manager.analyze(app_id, name)
        if analysis["state"] in ("extract", "setup"):
            # Unpacking or installing writes about as much again: refuse before starting, not halfway through.
            room = check_space(folder_size(folder), self.storage.root, Path(self.storage.preferences.load()["temporary_root"]), factor=1.0)
            if not room["ok"]:
                journal.note(folder, "espacio", room["message"])
                self.log.error("AppID %s: not adopted, %s", app_id, room["message"])
                return {"ok": False, "error": room["message"]}
        outcome = self.manager.repair(app_id, name, progress)
        if not outcome["ok"]:
            self.log.error("AppID %s: adoption failed: %s", app_id, outcome.get("error"))
            return outcome
        folder = self.storage.folder(app_id, name)
        freed = 0
        for backup in obsolete_backups(self.storage.launcher, app_id, folder):
            size = backup.stat().st_size
            backup.unlink()
            freed += size
            journal.note(folder, "limpieza", f"copia comprimida duplicada eliminada: {backup.name} ({size} bytes)")
        if freed and not any(p.is_file() and is_backup_name(p.name) and p.name != BACKUP_MARKER for p in folder.iterdir()):
            (folder / BACKUP_MARKER).unlink(missing_ok=True)
        (folder / "error.txt").unlink(missing_ok=True)
        self.log.info("AppID %s: adopted as %s; freed %s bytes", app_id, folder.name, freed)
        return {**outcome, "freed_bytes": freed}
