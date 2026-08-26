"""Steam account-switching helper for the gameAccess desktop MVP.

This module deliberately does NOT read, store, inject, or manipulate Steam
passwords, Steam Guard secrets, cookies, tokens, login keys, or other auth
material. It automates only the visible Steam account chooser that Steam itself
presents for already remembered/authorized accounts.

The first implementation is intentionally conservative: it can restart Steam
and wait for its UI. Account-name selection is exposed as an adapter boundary
for a Windows UI Automation implementation after we validate the exact chooser
controls on the test machine.
"""

from __future__ import annotations

import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SteamSwitchResult:
    ok: bool
    stage: str
    message: str


def find_steam_exe() -> Path | None:
    candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Steam" / "steam.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Steam" / "steam.exe",
        Path(r"C:\Steam\steam.exe"),
    ]
    return next((p for p in candidates if p.exists()), None)


def stop_steam(timeout: float = 12.0) -> SteamSwitchResult:
    """Ask Steam to exit, then wait for the client process to disappear."""
    steam = find_steam_exe()
    if not steam:
        return SteamSwitchResult(False, "locate", "Steam executable was not found")

    # Steam's shutdown URI requests a normal client shutdown rather than
    # killing the process, reducing the chance of corrupting client state.
    try:
        subprocess.Popen([str(steam), "steam://exit"], close_fds=True)
    except OSError as exc:
        return SteamSwitchResult(False, "shutdown", f"Could not request Steam shutdown: {exc}")

    deadline = time.time() + timeout
    while time.time() < deadline:
        check = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"],
            capture_output=True,
            text=True,
            check=False,
        )
        if "steam.exe" not in check.stdout.lower():
            return SteamSwitchResult(True, "shutdown", "Steam closed cleanly")
        time.sleep(0.5)

    return SteamSwitchResult(False, "shutdown", "Steam did not close before timeout")


def start_steam() -> SteamSwitchResult:
    steam = find_steam_exe()
    if not steam:
        return SteamSwitchResult(False, "locate", "Steam executable was not found")
    try:
        subprocess.Popen([str(steam)], close_fds=True)
        return SteamSwitchResult(True, "start", "Steam started; waiting for its remembered-account chooser")
    except OSError as exc:
        return SteamSwitchResult(False, "start", f"Could not start Steam: {exc}")


def restart_to_account_chooser() -> SteamSwitchResult:
    stopped = stop_steam()
    if not stopped.ok:
        return stopped
    time.sleep(1.0)
    return start_steam()


def select_remembered_account(account_label: str) -> SteamSwitchResult:
    """Adapter boundary for visible UI automation.

    We intentionally do not fall back to credential injection or editing Steam
    authentication state. The Windows UIA implementation will select only an
    account already displayed by Steam's own chooser.
    """
    if not account_label.strip():
        return SteamSwitchResult(False, "select", "No remembered account label was supplied")
    return SteamSwitchResult(
        False,
        "select",
        "Steam chooser selection is not calibrated yet. Restart is implemented; UIA account selection needs one local chooser inspection.",
    )
