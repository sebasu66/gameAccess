"""Games with an anti-cheat (EasyAntiCheat, BattlEye, XIGNCODE3, nProtect GameGuard) need its Windows service. A game
installs it the first time it runs as administrator; on a new PC, or when the service was stopped or removed, the game
closes at once or says "anti-cheat not installed". The game's files say which one it ships; the service tells whether
it is there. Nothing here downloads or patches an anti-cheat."""
from __future__ import annotations
import fnmatch
import os
import subprocess
import sys
from pathlib import Path

_HIDDEN = 0x08000000
SCAN_DEPTH = 3
SCAN_LIMIT = 6000
# id -> (name, file or folder names it ships with, Windows service names it installs)
ANTICHEATS: dict[str, dict] = {
    "eac": {"name": "EasyAntiCheat", "hints": ["easyanticheat*", "easyanticheat_*setup.exe"], "services": ["EasyAntiCheat", "EasyAntiCheat_EOS"]},
    "battleye": {"name": "BattlEye", "hints": ["beservice*.exe", "battleye", "beclient*.dll"], "services": ["BEService"]},
    "xigncode": {"name": "XIGNCODE3", "hints": ["xigncode*", "xhunter*"], "services": ["xhunter1"]},
    "gameguard": {"name": "nProtect GameGuard", "hints": ["gameguard", "npggnt*.des", "gameguard.des"], "services": ["npggsvc"]},
}


def shipped_with(folder: Path) -> list[str]:
    root = Path(folder)
    if not root.is_dir():
        return []
    found: set[str] = set()
    seen = 0
    for current, directories, files in os.walk(root):
        if len(Path(current).relative_to(root).parts) >= SCAN_DEPTH:
            directories[:] = []
        for name in [*files, *directories]:
            seen += 1
            lowered = name.lower()
            for key, info in ANTICHEATS.items():
                if key not in found and any(fnmatch.fnmatch(lowered, hint) for hint in info["hints"]):
                    found.add(key)
        if seen > SCAN_LIMIT:
            break
    return [key for key in ANTICHEATS if key in found]


def service_state(name: str) -> str:
    """"running", "stopped" (installed) or "missing" for a Windows service; "unknown" when Windows does not answer."""
    if sys.platform != "win32":
        return "unknown"
    try:
        done = subprocess.run(["sc", "query", name], capture_output=True, timeout=10, creationflags=_HIDDEN)
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    if done.returncode == 1060:  # ERROR_SERVICE_DOES_NOT_EXIST
        return "missing"
    text = (done.stdout or b"").decode("utf-8", "replace").upper()
    return "running" if "RUNNING" in text else "stopped" if "STOPPED" in text else "unknown"


def state(anticheat: str, query=service_state) -> str:
    """The best state among the anti-cheat's services: running, stopped, missing or unknown."""
    states = [query(name) for name in ANTICHEATS[anticheat]["services"]]
    for wanted in ("running", "stopped", "unknown"):
        if wanted in states:
            return wanted
    return "missing"


def start_service(anticheat: str, query=service_state) -> tuple[bool, str]:
    """Starts an installed but stopped service (Windows asks the player for permission)."""
    if sys.platform != "win32":
        return False, "only on Windows"
    for name in ANTICHEATS[anticheat]["services"]:
        if query(name) != "stopped":
            continue
        script = f"$p = Start-Process -FilePath sc.exe -ArgumentList 'start','{name}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode"
        try:
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, timeout=60, creationflags=_HIDDEN)
        except (OSError, subprocess.SubprocessError) as error:
            return False, str(error)
        return (query(name) == "running"), f"service {name}"
    return False, "no stopped service"
