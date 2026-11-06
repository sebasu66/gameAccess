"""Games that open through a store's launcher (Epic, Ubisoft Connect, EA app, Rockstar, Paradox, Battle.net). Without the
launcher running the game closes at once or waits for a sign-in nobody sees. The game's own files say which launcher it
asks for; before Play (and in the launch dialog's checks and automatic fix) the launcher is started in the background
when it is installed and not running. Nothing here installs a launcher or signs in: the player does that once."""
from __future__ import annotations
import fnmatch
import os
import subprocess
import sys
import time
from pathlib import Path

_HIDDEN = 0x08000000
SCAN_DEPTH = 3
SCAN_LIMIT = 6000

# id -> (name, file names that say a game asks for it, where its program is, its process names)
LAUNCHERS: dict[str, dict] = {
    "epic": {"name": "Epic Games Launcher", "hints": [".egstore"],
             "paths": [r"%ProgramFiles(x86)%\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe", r"%ProgramFiles(x86)%\Epic Games\Launcher\Portal\Binaries\Win32\EpicGamesLauncher.exe"],
             "processes": ["EpicGamesLauncher.exe"]},
    "ubisoft": {"name": "Ubisoft Connect", "hints": ["uplay_r1_loader*.dll", "uplay_r2_loader*.dll", "upc_r2_loader*.dll", "uplay_install.manifest", "UplayWebCore.dll"],
                "paths": [r"%ProgramFiles(x86)%\Ubisoft\Ubisoft Game Launcher\UbisoftConnect.exe", r"%ProgramFiles(x86)%\Ubisoft\Ubisoft Game Launcher\upc.exe"],
                "processes": ["UbisoftConnect.exe", "upc.exe"]},
    "ea": {"name": "EA app", "hints": ["OriginSDK.dll", "EAAntiCheat*.exe", "EAAntiCheat*.sys", "EAAntiCheat*.dll"],
           "paths": [r"%ProgramFiles%\Electronic Arts\EA Desktop\EA Desktop\EADesktop.exe"], "processes": ["EADesktop.exe"]},
    "rockstar": {"name": "Rockstar Games Launcher", "hints": ["PlayGTAV.exe", "LauncherPatcher.exe", "RockstarService.exe"],
                 "paths": [r"%ProgramFiles%\Rockstar Games\Launcher\Launcher.exe"], "processes": ["RockstarService.exe", "SocialClubHelper.exe"]},
    "paradox": {"name": "Paradox Launcher", "hints": ["launcher-settings.json"],
                "paths": [r"%LOCALAPPDATA%\Programs\Paradox Interactive\launcher\Paradox Launcher.exe", r"%LOCALAPPDATA%\Programs\Paradox Interactive\launcher\launcher.exe"],
                "processes": ["Paradox Launcher.exe"]},
    "battlenet": {"name": "Battle.net", "hints": [".build.info", ".product.db"],
                  "paths": [r"%ProgramFiles(x86)%\Battle.net\Battle.net.exe"], "processes": ["Battle.net.exe"]},
}
KNOWN = tuple(LAUNCHERS)


def needed_by(folder: Path) -> list[str]:
    """The launchers a game's own files ask for (a few levels deep: the files that say so sit by the executable)."""
    root = Path(folder)
    if not root.is_dir():
        return []
    patterns = {launcher: [hint.lower() for hint in info["hints"]] for launcher, info in LAUNCHERS.items()}
    found: set[str] = set()
    seen = 0
    for current, directories, files in os.walk(root):
        depth = len(Path(current).relative_to(root).parts)
        if depth >= SCAN_DEPTH:
            directories[:] = []
        for name in [*files, *directories]:
            seen += 1
            lowered = name.lower()
            for launcher, hints in patterns.items():
                if launcher not in found and any(fnmatch.fnmatch(lowered, hint) for hint in hints):
                    found.add(launcher)
        if seen > SCAN_LIMIT or len(found) == len(patterns):
            break
    return [launcher for launcher in KNOWN if launcher in found]


def program(launcher: str) -> Path | None:
    for template in LAUNCHERS[launcher]["paths"]:
        candidate = Path(os.path.expandvars(template))
        if candidate.is_file():
            return candidate
    return None


def running(launcher: str) -> bool:
    if sys.platform != "win32":
        return False
    for image in LAUNCHERS[launcher]["processes"]:
        try:
            out = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {image}", "/NH"], capture_output=True, timeout=8, creationflags=_HIDDEN).stdout or b""
        except (OSError, subprocess.SubprocessError):
            continue
        if image.lower().encode() in out.lower():
            return True
    return False


def start(launcher: str, wait: float = 20.0, logger=None, is_running=running, sleep=time.sleep, clock=time.monotonic) -> tuple[bool, str]:
    """Starts the launcher in the background (never as administrator, never signing in) and waits for its process.
    (ok, why): ok is also true when it was already running; false when it is not installed or did not appear."""
    name = LAUNCHERS[launcher]["name"]
    if is_running(launcher):
        return True, "already running"
    exe = program(launcher)
    if exe is None:
        return False, f"{name} is not installed"
    if logger:
        logger.info("Starting %s in the background: the game asks for it", name)
    subprocess.Popen([str(exe)], cwd=str(exe.parent), close_fds=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | 0x00000008)
    deadline = clock() + wait
    while clock() < deadline:
        if is_running(launcher):
            sleep(4)  # it needs a few seconds before a game can talk to it
            return True, "started in the background"
        sleep(1)
    return False, f"{name} did not start"
