"""Game Execution Manager: looks at a game folder, works out what it needs to run, and does it.

A small state machine that is independent of how the game arrived (first download, a repair
from the library, or a future import of games outside the catalog):

    analyze -> empty | extract | setup | blocked | ready
    prepare -> loops: extract archives, run the silent installer, then require a runnable executable

Every action is written to the game's own log (game_journal). Callers own the folder status
(preparing/installing/ready/ERROR); this module only inspects, acts and reports."""
from __future__ import annotations
import re
from pathlib import Path
import game_journal as journal
from execution_profile import load_profile, executable_matches
from setup_installer import find_setup, install_if_needed, has_game_executable

BACKUP_NAME = re.compile(r"_backup(?:\.|$)|^backup for .*\.zip$", re.I)
ARCHIVE = re.compile(r"\.(?:zip|rar|7z|tar|tar\.gz|tgz|001)$", re.I)
NOT_A_GAME = r"setup|install|unins|redist|crash|report|helper|unitycrash|vc_redist|wdapp|dump_client|dxsetup|prereq"
MAX_ROUNDS = 4


class GameExecutionError(RuntimeError):
    """A step failed and nothing more can be done automatically. `file` is what was being processed."""
    def __init__(self, message: str, file: str = ""):
        super().__init__(message)
        self.file = file


def rank_executable(exe_path: Path, game_name: str) -> float:
    score = 0.0
    exe_name = exe_path.stem.lower()
    g_name = game_name.lower()
    if exe_name in g_name or g_name in exe_name:
        score += 10.0
    for word in re.findall(r"\w+", g_name):
        if len(word) > 2 and word in exe_name:
            score += 5.0
    if len(exe_path.parents) >= 2 and exe_path.parent == exe_path.parents[-2]:
        score += 2.0
    return score


def find_candidates(folder: Path, name: str, command: str = "", patterns=(), logger=None) -> list[tuple[Path, list[str]]]:
    """Executables worth trying, best first: explicit command, remembered one, play.bat, then heuristics + profile patterns."""
    import shlex
    folder = Path(folder)
    if command.strip():
        if re.search(r"[&|<>\r\n]|steam:", command, re.I):
            raise ValueError("Comando rechazado: contiene caracteres prohibidos.")
        parts = shlex.split(command, posix=False)
        executable = (folder / parts[0].strip('"')).resolve()
        if executable.is_relative_to(folder) and executable.is_file():
            return [(executable, [p.strip('"') for p in parts[1:]])]
    marker = folder / ".gameaccess_exe"
    if marker.is_file():
        try:
            target = (folder / marker.read_text(encoding="utf-8").strip()).resolve()
            if target.is_file() and target.is_relative_to(folder.resolve()):
                return [(target, [])]
        except Exception:
            pass
    play_bat = folder / "play.bat"
    if play_bat.is_file():
        return [(play_bat, [])]
    candidates = [p for p in folder.rglob("*.exe") if not re.search(NOT_A_GAME, str(p.relative_to(folder)), re.I)]
    if not candidates:
        raise ValueError("No se encontraron ejecutables validos en la carpeta.")
    candidates.sort(key=lambda p: rank_executable(p, name), reverse=True)
    if patterns:
        # The profile's list is tried first, in its own order; GAMENAME stands for the game's name.
        plain = re.sub(r"[^A-Za-z0-9]+", "", name)
        expanded = [pattern for raw in patterns for pattern in dict.fromkeys(
            [re.sub("GAMENAME", name, raw, flags=re.I), re.sub("GAMENAME", plain, raw, flags=re.I)])]
        preferred = executable_matches(candidates, expanded)
        candidates = preferred + [c for c in candidates if c not in preferred]
    if logger:
        logger.info("Se probaran %s ejecutables en orden: %s", len(candidates), [p.name for p in candidates])
    return [(c.resolve(), []) for c in candidates]


def pending_archives(folder: Path) -> list[Path]:
    """Archives still lying in the folder that are not the retained fix backup (first volume only)."""
    found = []
    for path in Path(folder).rglob("*"):
        if not path.is_file() or path.is_symlink() or not ARCHIVE.search(path.name) or BACKUP_NAME.search(path.name):
            continue
        if re.search(r"\.part(?!0*1\b)\d+\.rar$", path.name, re.I):
            continue
        found.append(path)
    return sorted(found, key=lambda p: (len(p.relative_to(folder).parts), p.name.lower()))


class GameExecutionManager:
    def __init__(self, storage, extractor=None, installer=None, logger=None):
        """`extractor(folder, archive_path)` unpacks one archive into the folder (None = extraction already done by the caller)."""
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
        folder = self.storage.folder(app_id, name)
        journal.note(folder, "analisis", "empieza el análisis de la carpeta")
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


class _NullLogger:
    def info(self, *args, **kwargs): pass
    warning = error = debug = info
