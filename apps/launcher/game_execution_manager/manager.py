"""Game Execution Manager: looks at a game folder, works out what it needs to run, and does it.

A small state machine that is independent of how the game arrived (first download, a repair
from the library, or a future import of games outside the catalog):

    analyze -> empty | extract | setup | blocked | ready
    prepare -> loops: extract archives, run the silent installer, then require a runnable executable
    repair  -> prepare + the folder status (installing -> ready, or ERROR with the reason in the log)

Every action is written to the game's own log (game_journal)."""
from __future__ import annotations
import game_journal as journal
from .archives import pending_archives
from .execution_profile import load_profile
from .executables import find_candidates, has_game_executable
from .setup_installer import find_setup, install_if_needed

MAX_ROUNDS = 4


class GameExecutionError(RuntimeError):
    """A step failed and nothing more can be done automatically. `file` is what was being processed."""
    def __init__(self, message: str, file: str = ""):
        super().__init__(message)
        self.file = file


class GameExecutionManager:
    def __init__(self, storage, extractor=None, installer=None, logger=None):
        """`storage` provides folder/status/has_content; `extractor(folder, archive)` unpacks one
        archive (None = extraction was already done by the caller); `installer` runs setup exes."""
        self.storage = storage
        self.extractor = extractor
        self.installer = installer
        self.logger = logger

    def analyze(self, app_id: int, name: str) -> dict:
        """Side-effect-free diagnosis: {state, ready, warning, needs: [...], executable}."""
        folder = self.storage.folder(app_id, name)
        if not folder.is_dir() or not any(self.storage.has_content(folder)):
            return {"state": "empty", "ready": False, "warning": "La carpeta del juego está vacía.", "needs": ["download"], "executable": ""}
        profile = load_profile(self.storage.launcher, app_id)
        if has_game_executable(folder) or (folder / "play.bat").is_file():
            try:
                exe = find_candidates(folder, name, patterns=profile.get("executablePatterns", []))[0][0]
                return {"state": "ready", "ready": True, "warning": "", "needs": [], "executable": str(exe.relative_to(folder))}
            except ValueError:
                pass
        if pending_archives(folder):
            return {"state": "extract", "ready": False, "warning": "Hay archivos comprimidos sin descomprimir.", "needs": ["extract"], "executable": ""}
        setup = find_setup(folder, profile.get("setupPattern") or "setup*.exe")
        if setup is not None and profile.get("runSetup") is not False:
            return {"state": "setup", "ready": False, "warning": f"Falta ejecutar el instalador ({setup.name}).", "needs": ["setup"], "executable": ""}
        return {"state": "blocked", "ready": False, "warning": "No se encontró ningún ejecutable del juego.", "needs": [], "executable": ""}

    def prepare(self, app_id: int, name: str, progress=lambda text: None) -> dict:
        """Do whatever is needed so the game can run. Raises GameExecutionError when nothing more can be done."""
        journal.note(self.storage.folder(app_id, name), "analisis", "empieza el análisis de la carpeta")
        extraction_tried = False
        for _ in range(MAX_ROUNDS):
            folder = self.storage.folder(app_id, name)
            result = self.analyze(app_id, name)
            journal.note(folder, "analisis", f"estado={result['state']}" + (f"; ejecutable={result['executable']}" if result["executable"] else ""))
            if result["ready"]:
                return result
            if result["state"] == "extract" and self.extractor and not extraction_tried:
                extraction_tried = True
                for archive in pending_archives(folder):
                    progress(f"Descomprimiendo {archive.name}...")
                    journal.note(folder, "descompresión", f"{archive.name}")
                    try:
                        self.extractor(folder, archive)
                    except Exception as error:
                        raise GameExecutionError(f"error intentando descomprimir {archive.name}: {error}", archive.name) from error
                continue
            if result["state"] in ("extract", "setup"):
                profile = load_profile(self.storage.launcher, app_id)
                setup = find_setup(folder, profile.get("setupPattern") or "setup*.exe")
                if setup is not None:
                    try:
                        if install_if_needed(folder, profile, self.logger or _NullLogger(), progress, **({"runner": self.installer} if self.installer else {})):
                            continue
                    except RuntimeError as error:
                        raise GameExecutionError(str(error), setup.name) from error
            break
        final = self.analyze(app_id, name)
        if not final["ready"]:
            raise GameExecutionError(final["warning"])
        return final

    def repair(self, app_id: int, name: str, progress=lambda text: None) -> dict:
        """The wizard: `installing` while it works, `ready` when a runnable executable exists, `ERROR` otherwise."""
        self.storage.set_status(app_id, name, "installing")
        try:
            analysis = self.prepare(app_id, name, progress)
        except GameExecutionError as error:
            self.storage.write_error(app_id, name, str(error))
            return {"ok": False, "error": str(error), "file": error.file}
        self.storage.set_status(app_id, name, "ready")
        journal.note(self.storage.folder(app_id, name), "reparación", f"listo; ejecutable {analysis['executable']}")
        return {"ok": True, "analysis": analysis}


class _NullLogger:
    def info(self, *args, **kwargs): pass
    warning = error = debug = info
