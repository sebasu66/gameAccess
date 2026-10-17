"""Silent run of a game's own installer (GOG/Inno `setup*.exe`) during the `installing` phase.

Declared by the execution profile (`runSetup`, `setupPattern`, `setupArguments`, `runAsAdmin`);
with `runSetup` unset it is automatic: only when the folder has a setup exe and no game exe."""
from __future__ import annotations
import re
import game_journal as journal
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

DEFAULT_PATTERN = "setup*.exe"
DEFAULT_ARGUMENTS = ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOICONS"]
TARGET_FOLDER = "Game"
TIMEOUT_SECONDS = 2 * 60 * 60
NOT_A_GAME = re.compile(r"setup|install|unins|redist|crash|report|helper|vc_redist|dxsetup|prereq|dotnet|vcredist", re.I)


def find_setup(folder, pattern=DEFAULT_PATTERN):
    root = Path(folder).resolve()
    found = sorted((p for p in root.rglob("*.exe") if fnmatch(p.name.lower(), (pattern or DEFAULT_PATTERN).lower())
                    and not p.name.lower().startswith("unins") and p.resolve().is_relative_to(root) and not p.is_symlink()),
                   key=lambda p: (len(p.relative_to(root).parts), p.name.lower()))
    return found[0] if found else None


def has_game_executable(folder):
    root = Path(folder).resolve()
    return any(p.is_file() and not NOT_A_GAME.search(str(p.relative_to(root))) for p in root.rglob("*.exe"))


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


def build_command(setup, target, profile):
    arguments = list(profile.get("setupArguments") or DEFAULT_ARGUMENTS)
    return [str(setup), *arguments, f"/DIR={target}"]


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


def install_if_needed(folder, profile, logger, progress=lambda text: None, runner=run_installer):
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
    code = runner(build_command(setup, target, profile), bool(profile.get("runAsAdmin")))
    if code != 0:
        journal.note(folder, "instalador", f"falló con código {code}")
        raise RuntimeError(f"error intentando instalar {setup.name}: el instalador terminó con código {code}")
    if not has_game_executable(target):
        raise RuntimeError(f"error intentando instalar {setup.name}: terminó pero no dejó ningún ejecutable del juego")
    remove_installer_files(setup)
    logger.info("Setup: %s finished; installer files removed", setup.name)
    return True
