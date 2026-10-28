"""Finding the executable that starts a game."""
from __future__ import annotations
import re
import shlex
from pathlib import Path
from .execution_profile import executable_matches

# One list of files that are never the game itself (installers, helpers, redistributables).
NOT_A_GAME = re.compile(r"setup|install|unins|remove|updater|redist|crash|report|helper|unitycrash|vc_redist|wdapp|dump_client|dxsetup|prereq|dotnet|vcredist", re.I)


# Anything that can start a program, installers included. A download with none of these cannot be a game.
RUNNABLE_SUFFIXES = {".exe", ".bat", ".cmd", ".msi", ".com"}
CONTENT_KINDS = {
    "audio": {".mp3", ".flac", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".wma", ".ape", ".cue"},
    "images": {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".psd", ".svg"},
    "video": {".mp4", ".mkv", ".avi", ".webm", ".mov", ".wmv", ".m4v"},
    "documents": {".pdf", ".txt", ".nfo", ".doc", ".docx", ".epub", ".html", ".htm", ".md", ".rtf"},
}


def not_a_game(folder: Path) -> list[str] | None:
    """None when the folder may hold a game (it has something runnable, or archives still to unpack). Otherwise what it
    holds instead, e.g. ["audio", "images"] for a soundtrack and artbook: such a download is not a game at all."""
    from .archives import pending_archives
    root = Path(folder)
    files = [p for p in root.rglob("*") if p.is_file() and not p.is_symlink()]
    if any(p.suffix.lower() in RUNNABLE_SUFFIXES for p in files) or pending_archives(root):
        return None
    suffixes = {p.suffix.lower() for p in files}
    kinds = [kind for kind, known in CONTENT_KINDS.items() if suffixes & known]
    return kinds or ["other"]


def has_game_executable(folder: Path) -> bool:
    root = Path(folder).resolve()
    return any(p.is_file() and not NOT_A_GAME.search(str(p.relative_to(root))) for p in root.rglob("*.exe"))


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
    candidates = [p for p in folder.rglob("*.exe") if not NOT_A_GAME.search(str(p.relative_to(folder)))]
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
