from __future__ import annotations

import argparse
import os
import subprocess
import time
from pathlib import Path

from provider_roster import credential_by_provider_id


def _creationflags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def _steam_running() -> bool:
    if os.name != "nt":
        return False
    result = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"],
        capture_output=True,
        text=True,
        check=False,
        creationflags=_creationflags(),
    )
    return "steam.exe" in result.stdout.casefold()


def _find_steam_exe() -> Path:
    candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Steam" / "steam.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Steam" / "steam.exe",
        Path(r"C:\Steam\steam.exe"),
    ]
    steam = next((path for path in candidates if path.is_file()), None)
    if steam is None:
        raise RuntimeError("Steam executable was not found")
    return steam


def _stop_steam(steam: Path) -> None:
    if not _steam_running():
        return
    subprocess.Popen(
        [str(steam), "steam://exit"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=_creationflags(),
    )
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if not _steam_running():
            return
        time.sleep(0.4)
    subprocess.run(
        ["taskkill", "/F", "/IM", "steam.exe", "/T"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
        creationflags=_creationflags(),
    )
    time.sleep(1)


def login(provider_id: str) -> None:
    credential = credential_by_provider_id(provider_id)
    if credential is None:
        raise RuntimeError(f"Provider account not found: {provider_id}")
    steam = _find_steam_exe()
    _stop_steam(steam)
    subprocess.Popen(
        [str(steam), "-silent", "-login", credential.login, credential.password],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=_creationflags(),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Log Steam into one GameAccess provider account")
    parser.add_argument("provider_id")
    args = parser.parse_args()
    login(args.provider_id)
    print(f"Steam login started for {args.provider_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
