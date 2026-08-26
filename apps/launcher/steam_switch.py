"""Steam account-switching helper for the gameAccess desktop MVP.

Security boundary:
- never read/store/inject Steam passwords;
- never read/store Steam Guard secrets, cookies, tokens, login keys, or auth blobs;
- automate only Steam's *visible* remembered-account chooser using Windows UI Automation.

This is intentionally a UI adapter, not an authentication bypass.
"""

from __future__ import annotations

import os
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from pywinauto import Desktop


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


def _steam_running() -> bool:
    check = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"],
        capture_output=True,
        text=True,
        check=False,
    )
    return "steam.exe" in check.stdout.lower()


def stop_steam(timeout: float = 15.0) -> SteamSwitchResult:
    steam = find_steam_exe()
    if not steam:
        return SteamSwitchResult(False, "locate", "Steam executable was not found")

    if not _steam_running():
        return SteamSwitchResult(True, "shutdown", "Steam was already closed")

    try:
        subprocess.Popen([str(steam), "steam://exit"], close_fds=True)
    except OSError as exc:
        return SteamSwitchResult(False, "shutdown", f"Could not request Steam shutdown: {exc}")

    deadline = time.time() + timeout
    while time.time() < deadline:
        if not _steam_running():
            return SteamSwitchResult(True, "shutdown", "Steam closed cleanly")
        time.sleep(0.5)

    return SteamSwitchResult(False, "shutdown", "Steam did not close before timeout")


def start_steam() -> SteamSwitchResult:
    steam = find_steam_exe()
    if not steam:
        return SteamSwitchResult(False, "locate", "Steam executable was not found")
    try:
        subprocess.Popen([str(steam)], close_fds=True)
        return SteamSwitchResult(True, "start", "Steam started")
    except OSError as exc:
        return SteamSwitchResult(False, "start", f"Could not start Steam: {exc}")


def restart_to_account_chooser() -> SteamSwitchResult:
    stopped = stop_steam()
    if not stopped.ok:
        return stopped
    time.sleep(1.0)
    return start_steam()


def _steam_windows() -> Iterable:
    """Return visible top-level windows that plausibly belong to Steam.

    Steam UI is Chromium-based, so exact control types can vary between client
    releases. We intentionally search visible UIA text/buttons instead of
    relying on private files or auth state.
    """
    desktop = Desktop(backend="uia")
    for win in desktop.windows():
        try:
            title = (win.window_text() or "").strip()
            proc_name = ""
            try:
                proc = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {win.process_id()}", "/FO", "CSV", "/NH"],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                proc_name = proc.stdout.lower()
            except Exception:
                pass
            if "steam" in title.lower() or "steam.exe" in proc_name or "steamwebhelper.exe" in proc_name:
                yield win
        except Exception:
            continue


def visible_steam_texts() -> list[str]:
    """Diagnostic helper: return visible non-empty UI texts from Steam windows.

    This reads only what is already visible on screen. It does not inspect
    credential stores or Steam auth files.
    """
    texts: list[str] = []
    seen: set[str] = set()
    for win in _steam_windows():
        try:
            controls = [win] + list(win.descendants())
        except Exception:
            controls = [win]
        for ctrl in controls:
            try:
                text = (ctrl.window_text() or "").strip()
            except Exception:
                continue
            if text and text not in seen:
                seen.add(text)
                texts.append(text)
    return texts


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).casefold()


def wait_for_account_chooser(timeout: float = 20.0) -> SteamSwitchResult:
    """Wait until Steam exposes a remembered-account chooser-like UI."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        texts = visible_steam_texts()
        joined = " | ".join(texts).casefold()
        # Locale-independent fallback is presence of multiple clickable-ish
        # account rows; locale hints simply make detection faster.
        hints = ("choose an account", "select an account", "elegir una cuenta", "seleccionar una cuenta", "who's playing")
        if any(h in joined for h in hints):
            return SteamSwitchResult(True, "chooser", "Steam account chooser detected")
        if len(texts) >= 3 and _steam_running():
            # Steam's chooser can expose sparse UIA metadata depending on build;
            # let selection perform the final exact-match check.
            return SteamSwitchResult(True, "chooser", "Steam UI detected; attempting account match")
        time.sleep(0.5)
    return SteamSwitchResult(False, "chooser", "Steam account chooser was not detected before timeout")


def select_remembered_account(account_label: str, timeout: float = 20.0) -> SteamSwitchResult:
    """Click a remembered account already shown in Steam's chooser.

    `account_label` must match visible chooser text (case-insensitive). No
    username/password entry is attempted. If the label is not visible, the
    function fails closed and leaves Steam untouched.
    """
    target = _normalize(account_label)
    if not target:
        return SteamSwitchResult(False, "select", "No remembered account label was supplied")

    chooser = wait_for_account_chooser(timeout=timeout)
    if not chooser.ok:
        return chooser

    deadline = time.time() + timeout
    while time.time() < deadline:
        for win in _steam_windows():
            try:
                controls = [win] + list(win.descendants())
            except Exception:
                controls = [win]
            for ctrl in controls:
                try:
                    text = (ctrl.window_text() or "").strip()
                except Exception:
                    continue
                if _normalize(text) != target:
                    continue

                # Prefer semantic UIA invocation where available; otherwise
                # click the center of the visible account row/text.
                try:
                    iface = ctrl.iface_invoke
                    iface.Invoke()
                    return SteamSwitchResult(True, "select", f"Selected remembered Steam account: {account_label}")
                except Exception:
                    pass
                try:
                    ctrl.click_input()
                    return SteamSwitchResult(True, "select", f"Selected remembered Steam account: {account_label}")
                except Exception as exc:
                    return SteamSwitchResult(False, "select", f"Found account label but could not click it: {exc}")
        time.sleep(0.5)

    visible = visible_steam_texts()
    sample = ", ".join(visible[:20]) if visible else "<no visible Steam text>"
    return SteamSwitchResult(
        False,
        "select",
        f"Remembered account '{account_label}' was not found in Steam's visible chooser. Visible UI sample: {sample}",
    )


def switch_to_remembered_account(account_label: str) -> SteamSwitchResult:
    """Restart Steam and select one remembered account from its visible UI."""
    restarted = restart_to_account_chooser()
    if not restarted.ok:
        return restarted
    return select_remembered_account(account_label)
