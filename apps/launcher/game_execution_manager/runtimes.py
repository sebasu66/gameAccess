"""Libraries a game needs on a new PC. Games bring their own redistributables (`_CommonRedist`, `redist`, `DirectX`...):
this finds those installers, tells which of what they install is missing from Windows, and installs the missing ones
silently. It also reads the video driver's date (a very old driver is a usual cause of games that do not open)."""
from __future__ import annotations
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REDIST_DIRS = re.compile(r"^(_?commonredist|redist|redistributables?|directx|dx9?|dotnet|vcredist|vc_redist|prerequisites?|__installer|support)$", re.I)
INSTALLER = re.compile(r"(vc_?redist|vcredist|dxsetup|dxwebsetup)[^/\\]*\.exe$", re.I)
MAX_DEPTH = 4
# Visual C++ release (by year in the installer's name) -> the DLL it leaves in System32 / SysWOW64.
VC_DLL = {"2010": "msvcr100.dll", "2012": "msvcr110.dll", "2013": "msvcr120.dll"}
DIRECTX_DLLS = ("d3dx9_43.dll", "xinput1_3.dll")
OLD_DRIVER_DAYS = 540
_HIDDEN = 0x08000000
# Exit codes of a redistributable that mean "it is there": 3010 needs a restart, 1638 a newer one is installed.
ACCEPTED = {0, 1638, 3010}


def find_installers(folder: Path, limit: int = 40) -> list[Path]:
    """The redistributable installers the game ships, from folders named like a redist folder (up to MAX_DEPTH deep)."""
    root = Path(folder)
    found: list[Path] = []
    if not root.is_dir():
        return found
    stack = [(root, 0, False)]
    while stack and len(found) < limit:
        current, depth, inside = stack.pop()
        try:
            entries = sorted(current.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink():
                continue
            if entry.is_dir():
                if depth < MAX_DEPTH:
                    stack.append((entry, depth + 1, inside or bool(REDIST_DIRS.match(entry.name))))
            elif inside and INSTALLER.search(entry.name):
                found.append(entry)
    return found


def classify(installer: Path) -> tuple[str, str, tuple[str, ...]] | None:
    """(id, architecture, DLLs it provides) for an installer by its name; None when it is not one we can check."""
    name = installer.name.lower()
    arch = "x64" if "x64" in name or "amd64" in name else "x86"
    if "dxsetup" in name or "dxwebsetup" in name:
        return "directx", "x86", DIRECTX_DLLS
    year = next((y for y in VC_DLL if y in name), "")
    if year:
        return f"vc{year}", arch, (VC_DLL[year],)
    if re.search(r"vc_?redist", name) or re.search(r"2015|2017|2019|2022", name):
        return "vc2015", arch, ("vcruntime140.dll",)
    return None


def _system_dir(arch: str) -> Path:
    windows = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    # A 64-bit library is in System32; a 32-bit one in SysWOW64 (the other way round on a 32-bit Windows).
    return windows / ("System32" if arch == "x64" else "SysWOW64")


def missing_runtimes(folder: Path, exists=lambda path: path.is_file()) -> list[dict]:
    """The libraries the game's own redistributables would install and Windows does not have yet:
    [{id, arch, installer, dlls}] (one per kind and architecture)."""
    result: dict[tuple[str, str], dict] = {}
    for installer in find_installers(folder):
        kind = classify(installer)
        if not kind:
            continue
        key = (kind[0], kind[1])
        if key in result:
            continue
        base = _system_dir(kind[1])
        lacking = [dll for dll in kind[2] if not exists(base / dll)]
        if lacking:
            result[key] = {"id": kind[0], "arch": kind[1], "installer": str(installer), "dlls": lacking}
    return list(result.values())


def install_arguments(installer: Path) -> str:
    return "/silent" if "dxsetup" in installer.name.lower() else "/quiet /norestart"


def install(installer: Path, logger=None, timeout: int = 420) -> tuple[bool, str]:
    """Runs one redistributable silently as administrator (Windows asks for the permission) and waits for it."""
    if sys.platform != "win32":
        return False, "only on Windows"
    quoted = str(installer).replace("'", "''")
    script = (f"$p = Start-Process -FilePath '{quoted}' -ArgumentList '{install_arguments(installer)}' "
              f"-WorkingDirectory '{str(installer.parent).replace(chr(39), chr(39) * 2)}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode")
    try:
        done = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, timeout=timeout, creationflags=_HIDDEN)
    except (OSError, subprocess.SubprocessError) as error:
        return False, str(error)
    ok = done.returncode in ACCEPTED
    if logger:
        logger.info("Redistributable %s finished with code %s", installer.name, done.returncode)
    return ok, f"code {done.returncode}"


def video_driver() -> dict:
    """The main video driver: {name, version, date, age_days, old}; {} when Windows does not say."""
    if sys.platform != "win32":
        return {}
    script = ("Get-CimInstance Win32_VideoController | Where-Object { $_.DriverDate } | Sort-Object AdapterRAM -Descending | "
              "Select-Object -First 1 Name, DriverVersion, @{n='Date';e={$_.DriverDate.ToString('yyyy-MM-dd')}} | ConvertTo-Json -Compress")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=15, creationflags=_HIDDEN).stdout.strip()
        import json
        data = json.loads(out) if out else {}
        stamp = time.mktime(time.strptime(data["Date"], "%Y-%m-%d"))
    except (OSError, subprocess.SubprocessError, ValueError, KeyError):
        return {}
    age = int((time.time() - stamp) / 86400)
    return {"name": data.get("Name", ""), "version": data.get("DriverVersion", ""), "date": data["Date"], "age_days": age, "old": age > OLD_DRIVER_DAYS}
