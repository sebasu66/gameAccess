"""Game Importer: brings a game folder up to the current standard.

For a game that never came through the catalog download (or predates the standard): the folder is
already unpacked (or half so), has no status suffix, no log, maybe a full-size backup archive that
duplicates the game. `plan` says what bringing it up to the standard involves (the user reviews it),
`adopt` carries it out; the log simply starts at the moment the game was imported.
Importing from a path outside the games folder (copy/move, AppID lookup) will build on `adopt`."""
from __future__ import annotations
from pathlib import Path
import game_journal as journal
import app_log
from game_execution_manager.archives import is_backup_name, pending_archives
from game_execution_manager.execution_profile import declared_fix_archive, load_profile
from game_execution_manager.setup_installer import find_setup
from disk_space import GIB, check_space, folder_size

# A real fix archive is small; one this big is the downloaded game kept next to its own unpacked copy.
OBSOLETE_BACKUP_BYTES = 1 * GIB
BACKUP_MARKER = ".digital-backup.json"


def obsolete_backups(launcher, app_id: int, folder: Path) -> list[Path]:
    """Backup files that only duplicate the game: big, and not the fix the profile asks to re-apply."""
    kept = declared_fix_archive(load_profile(launcher, app_id))
    found = [p for p in Path(folder).iterdir() if p.is_file() and not p.is_symlink() and is_backup_name(p.name) and p.name != BACKUP_MARKER]
    return [p for p in found if p.stat().st_size >= OBSOLETE_BACKUP_BYTES and p.name != kept]


def _size(paths) -> int:
    return sum(p.stat().st_size for p in paths if p.is_file())


class GameImporter:
    def __init__(self, storage, manager):
        self.storage = storage
        self.manager = manager
        self.log = app_log.manager_logger("importer")

    def delete_sources(self) -> bool:
        """Setting "delete download sources" (on by default); the declared fix archive is never removed."""
        return bool(self.storage.preferences.load().get("delete_download_sources", True))

    # -- what is wrong ---------------------------------------------------------------------
    def issues(self, app_id: int | None, folder: Path, state: str | None, analysis: dict | None) -> list[dict]:
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
        if analysis and analysis["ready"] and self.delete_sources():
            duplicated = obsolete_backups(self.storage.launcher, app_id, folder)
            if duplicated:
                found.append({"code": "obsolete_backup", "message": "Guarda una copia comprimida que duplica el juego entero.", "bytes": _size(duplicated)})
        return found

    # -- what fixing would do (shown to the user before anything runs) -----------------------------
    def plan(self, app_id: int, name: str) -> dict:
        """The ordered actions `adopt` will carry out: [{code, label, bytes?}] plus the space it frees."""
        folder = self.storage.folder(app_id, name)
        if not folder.is_dir() or not any(self.storage.has_content(folder)):
            return {"app_id": app_id, "name": name, "actions": [{"code": "remove_empty", "label": "Borrar la carpeta vacía"}], "freed_bytes": 0}
        actions, freed = [], 0
        profile = load_profile(self.storage.launcher, app_id)
        analysis = self.manager.analyze(app_id, name)
        delete = self.delete_sources()
        if not (folder / journal.JOURNAL_FILE).is_file():
            actions.append({"code": "create_log", "label": "Crear el registro del juego (su historial empieza ahora)"})
        archives = pending_archives(folder)
        for archive in archives:
            actions.append({"code": "extract", "label": f"Descomprimir {archive.name}", "bytes": archive.stat().st_size})
            if delete:
                actions.append({"code": "delete_source", "label": f"Borrar {archive.name} una vez descomprimido", "bytes": archive.stat().st_size})
                freed += archive.stat().st_size
        setup = find_setup(folder, profile.get("setupPattern") or "setup*.exe") if analysis["state"] == "setup" else None
        if setup is not None:
            parts = [setup, *[p for p in setup.parent.iterdir() if p.suffix.lower() == ".bin" and p.name.startswith(setup.stem + "-")]]
            actions.append({"code": "setup", "label": f"Ejecutar el instalador {setup.name} en silencio", "bytes": _size(parts)})
            if delete:
                actions.append({"code": "delete_source", "label": f"Borrar el instalador y sus archivos .bin ({len(parts)} archivos)", "bytes": _size(parts)})
                freed += _size(parts)
        if analysis["state"] == "ready" or archives or setup is not None:
            actions.append({"code": "find_executable", "label": "Detectar el ejecutable del juego"})
        for backup in (obsolete_backups(self.storage.launcher, app_id, folder) if delete else []):
            actions.append({"code": "delete_source", "label": f"Borrar {backup.name} (copia comprimida que duplica el juego)", "bytes": backup.stat().st_size})
            freed += backup.stat().st_size
        kept = declared_fix_archive(profile)
        if kept and (folder / kept).is_file():
            actions.append({"code": "keep", "label": f"Conservar {kept} (fix que se reaplica al jugar)"})
        _, _, state = self._split(folder)
        if state != "ready":
            actions.append({"code": "rename", "label": f"Renombrar la carpeta a {self._split(folder)[1]}-ready"})
        return {"app_id": app_id, "name": name, "actions": actions, "freed_bytes": freed, "delete_sources": delete}

    @staticmethod
    def _split(folder: Path):
        from game_library_manager.storage import split_folder_name
        app_id, title, state = split_folder_name(folder.name)
        return app_id, f"{app_id}-{title}", state

    # -- doing it ------------------------------------------------------------------------------
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
        if self.delete_sources():
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
