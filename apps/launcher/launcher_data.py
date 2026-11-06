r"""Where the launcher keeps its own state (`.cache`, `logs`) and the default game and download folders.

A development checkout keeps the state inside `apps/launcher`, as always. An installed app lives in
Program Files, which a normal user cannot write: the desktop app then sets `GAMEACCESS_LAUNCHER_DATA`
(`%LOCALAPPDATA%\gameAccess\launcher`) for every launcher process it starts.

The installer lets the user choose the game and download folders; it stores them under
`HKLM\Software\gameAccess` (`GamesDir`, `DownloadsDir`). Without a choice, games go to `C:\GA_Juegos` (short and
plain: some games do not start from long paths, see game_paths.py) and downloads to each user's Downloads folder, in
`GameAccessDownloads`."""
from __future__ import annotations
import os
from pathlib import Path

LAUNCHER_DIR = Path(__file__).resolve().parent
REGISTRY_KEY = r"Software\gameAccess"
DOWNLOADS_FOLDER_ID = "{374DE290-123F-4565-9164-39C4925E467B}"


def installed() -> bool:
    return bool(os.environ.get("GAMEACCESS_LAUNCHER_DATA"))


def data_dir(launcher: Path | str | None = None) -> Path:
    configured = os.environ.get("GAMEACCESS_LAUNCHER_DATA")
    return Path(configured) if configured else Path(launcher or LAUNCHER_DIR).resolve()


def _installer_choice(name: str) -> str:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, REGISTRY_KEY, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return str(value).strip()
    except (ImportError, OSError):
        return ""


def _user_downloads() -> Path:
    """The user's Downloads folder, also when it was moved to another disk."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
            value, _ = winreg.QueryValueEx(key, DOWNLOADS_FOLDER_ID)
            if str(value).strip():
                return Path(os.path.expandvars(str(value)))
    except (ImportError, OSError):
        pass
    return Path.home() / "Downloads"


DEFAULT_GAMES_FOLDER = "GA_Juegos"
# The default before 2026-10-27: a PC that already keeps its games there goes on using it.
OLD_GAMES_FOLDER = "juegos_GameAccess"


def default_games_root() -> Path:
    chosen = _installer_choice("GamesDir")
    if chosen:
        return Path(chosen)
    drive = Path(os.environ.get("SystemDrive", "C:") + "\\")
    return drive / OLD_GAMES_FOLDER if (drive / OLD_GAMES_FOLDER).is_dir() else drive / DEFAULT_GAMES_FOLDER


def default_temporary_root() -> Path:
    chosen = _installer_choice("DownloadsDir")
    return Path(chosen) if chosen else _user_downloads() / "GameAccessDownloads"
