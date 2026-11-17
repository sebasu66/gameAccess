"""Silent run of a game's own installer (GOG/Inno `setup*.exe`) during the `installing` phase.

Declared by the execution profile (`runSetup`, `setupPattern`, `setupArguments`, `runAsAdmin`);
with `runSetup` unset it is automatic: only when the folder has a setup exe and no game exe."""
from __future__ import annotations
import game_journal as journal
from game_download_manager.ui_text import ui
from .executables import has_game_executable
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

DEFAULT_PATTERN = "setup*.exe"
DEFAULT_ARGUMENTS = ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOICONS"]
TARGET_FOLDER = "Game"
TIMEOUT_SECONDS = 2 * 60 * 60
# The installer's own log (Inno's /LOG), next to it in the game folder: when it fails, it says why.
LOG_FILE = "setup-install-log.txt"
# Inno Setup's exit codes (https://jrsoftware.org/ishelp/topic_setupexitcodes.htm), each said by the app as
# setupCode1..setupCode8 of its translations.
INNO_CODES = range(1, 9)
# A target deeper than this leaves little room for the game's own folders under Windows' 260-character limit.
LONG_TARGET = 80


def find_setup(folder, pattern=DEFAULT_PATTERN):
    root = Path(folder).resolve()
    found = sorted((p for p in root.rglob("*.exe") if fnmatch(p.name.lower(), (pattern or DEFAULT_PATTERN).lower())
                    and not p.name.lower().startswith("unins") and p.resolve().is_relative_to(root) and not p.is_symlink()),
                   key=lambda p: (len(p.relative_to(root).parts), p.name.lower()))
    return found[0] if found else None


def needs_setup(folder, profile):
    """The setup exe to run, or None. runSetup False disables, True forces, unset = automatic."""
    choice = profile.get("runSetup")
    if choice is False:
        return None
    setup = find_setup(folder, profile.get("setupPattern") or DEFAULT_PATTERN)
    if setup is None:
        return None
    if choice is None and has_game_executable(folder):
        return None
    return setup


def build_command(setup, target, profile, log=None):
    arguments = list(profile.get("setupArguments") or DEFAULT_ARGUMENTS)
    return [str(setup), *arguments, *([f"/LOG={log}"] if log else []), f"/DIR={target}"]


def log_reason(log: Path) -> str:
    """The lines of the installer's log that say why it stopped (Inno writes "Exception", "Fatal" or "Error")."""
    try:
        lines = Path(log).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    found = [line.split(" ", 2)[-1].strip() for line in lines if any(word in line for word in ("Exception", "Fatal", "Error", "error"))]
    return " / ".join(dict.fromkeys(found[-2:]))


def failure_message(setup, code: int, target: Path, log: Path) -> str:
    """What the player (and the log) is told: the code in words, the installer's own reason and, when the folder is
    deep, the likely cause (games that do not fit Windows' path limit)."""
    # Keys of the app's translations (ui_text): the app says it in its language; the installer's own words stay as
    # they came.
    parts = [ui("setupFailed", file=setup.name, code=code)]
    if code in INNO_CODES:
        parts.append(ui(f"setupCode{code}"))
    reason = log_reason(log)
    if reason:
        parts.append(ui("setupReason", reason=reason))
    if len(str(target)) > LONG_TARGET and code in (3, 4):
        parts.append(ui("setupLongPath", length=len(str(target))))
    return " ".join(parts)


def run_installer(command, as_admin, timeout=TIMEOUT_SECONDS):
    """Return the installer's exit code. Elevates through PowerShell when Windows asks for it."""
    def elevated():
        quoted = ",".join("'" + part.replace("'", "''") + "'" for part in command[1:])
        script = (f"$p = Start-Process -FilePath '{command[0]}' -ArgumentList {quoted} -Verb RunAs -Wait -PassThru; "
                  "exit $p.ExitCode")
        return subprocess.run(["powershell.exe", "-NoProfile", "-Command", script], timeout=timeout).returncode
    if as_admin and sys.platform == "win32":
        return elevated()
    try:
        return subprocess.run(command, cwd=str(Path(command[0]).parent), shell=False, timeout=timeout).returncode
    except OSError as error:
        if getattr(error, "winerror", None) == 740 and sys.platform == "win32":
            return elevated()
        raise


def remove_installer_files(setup):
    """Delete the setup exe and its sibling data files (setup_x.exe, setup_x-1.bin, ...)."""
    stem = setup.stem
    for item in setup.parent.iterdir():
        if item.is_file() and (item == setup or (item.name.startswith(stem + "-") and item.suffix.lower() == ".bin")):
            item.unlink(missing_ok=True)


def install_if_needed(folder, profile, logger, progress=lambda text: None, runner=run_installer, remove_sources: bool = True):
    """Run the installer once if needed. Raises RuntimeError with a user-readable message on failure."""
    folder = Path(folder).resolve()
    setup = needs_setup(folder, profile)
    if setup is None:
        return False
    target = folder / TARGET_FOLDER
    target.mkdir(exist_ok=True)
    progress(f"Instalando con {setup.name}...")
    logger.info("Setup: running %s into %s", setup, target)
    journal.note(folder, "instalador", f"ejecutando {setup.name} en silencio hacia {TARGET_FOLDER}")
    log = folder / LOG_FILE
    code = runner(build_command(setup, target, profile, log), bool(profile.get("runAsAdmin")))
    if code != 0:
        message = failure_message(setup, code, target, log)
        journal.note(folder, "instalador", f"falló con código {code}; {message}")
        raise RuntimeError(message)
    if not has_game_executable(target):
        raise RuntimeError(f"error intentando instalar {setup.name}: terminó pero no dejó ningún ejecutable del juego")
    if remove_sources:
        remove_installer_files(setup)
    logger.info("Setup: %s finished; installer files %s", setup.name, "removed" if remove_sources else "kept")
    return True
