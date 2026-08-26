"""Steam account switching for the gameAccess desktop MVP.

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


@dataclass(frozen=True)
class RememberedSteamAccount:
    display_name: str
    account_name: str

    @property
    def label(self) -> str:
        if self.display_name and self.display_name != self.account_name:
            return f"{self.display_name} ({self.account_name})"
        return self.account_name or self.display_name


def _creationflags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


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
        creationflags=_creationflags(),
    )
    return "steam.exe" in check.stdout.lower()


def stop_steam(timeout: float = 15.0) -> SteamSwitchResult:
    steam = find_steam_exe()
    if not steam:
        return SteamSwitchResult(False, "locate", "Steam executable was not found")

    if not _steam_running():
        return SteamSwitchResult(True, "shutdown", "Steam was already closed")

    try:
        subprocess.Popen([str(steam), "steam://exit"], close_fds=True, creationflags=_creationflags())
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
        subprocess.Popen([str(steam)], close_fds=True, creationflags=_creationflags())
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
    """Return visible top-level windows that plausibly belong to Steam."""
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
                    creationflags=_creationflags(),
                )
                proc_name = proc.stdout.lower()
            except Exception:
                pass
            if "steam" in title.lower() or "steam.exe" in proc_name or "steamwebhelper.exe" in proc_name:
                yield win
        except Exception:
            continue


def visible_steam_texts() -> list[str]:
    """Return non-empty text currently visible in Steam windows."""
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


def _account_name_value(text: str) -> str | None:
    patterns = (
        r"^nombre de la cuenta\s*:\s*(.+)$",
        r"^account name\s*:\s*(.+)$",
        r"^login name\s*:\s*(.+)$",
    )
    normalized = text.strip()
    for pattern in patterns:
        match = re.match(pattern, normalized, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            return value or None
    return None


def _plausible_display_name(text: str) -> bool:
    value = text.strip()
    if not value or len(value) > 100:
        return False
    lowered = _normalize(value)
    blocked = (
        "¿quién va a jugar?",
        "who's playing",
        "iniciar sesión en steam",
        "sign in to steam",
        "añadir cuenta",
        "add account",
        "nombre de la cuenta:",
        "account name:",
        "para obtener las descripciones",
        "minimizar",
        "maximizar",
        "cerrar",
        "sistema",
    )
    return not any(token in lowered for token in blocked)


def remembered_accounts_from_visible_texts(texts: list[str]) -> list[RememberedSteamAccount]:
    """Parse account cards exposed by Steam's visible chooser UI.

    Steam typically exposes one display-name text node immediately followed by
    a localized `Account name: ...` text node. We intentionally ignore merged
    container text and keep only those visible card pairs.
    """
    accounts: list[RememberedSteamAccount] = []
    seen: set[tuple[str, str]] = set()

    for index, text in enumerate(texts):
        account_name = _account_name_value(text)
        if not account_name:
            continue

        display_name = ""
        for previous in reversed(texts[max(0, index - 3):index]):
            if _plausible_display_name(previous):
                display_name = previous.strip()
                break
        if not display_name:
            display_name = account_name

        key = (_normalize(display_name), _normalize(account_name))
        if key in seen:
            continue
        seen.add(key)
        accounts.append(RememberedSteamAccount(display_name=display_name, account_name=account_name))

    return accounts


def remembered_accounts() -> list[RememberedSteamAccount]:
    return remembered_accounts_from_visible_texts(visible_steam_texts())


def account_chooser_visible() -> bool:
    texts = visible_steam_texts()
    joined = " | ".join(texts).casefold()
    hints = (
        "¿quién va a jugar?",
        "who's playing",
        "choose an account",
        "select an account",
        "elegir una cuenta",
        "seleccionar una cuenta",
        "añadir cuenta",
        "add account",
    )
    return any(hint in joined for hint in hints) and bool(remembered_accounts_from_visible_texts(texts))


def ensure_account_chooser(timeout: float = 22.0) -> SteamSwitchResult:
    """Reuse an already-visible chooser; otherwise restart Steam once."""
    if account_chooser_visible():
        return SteamSwitchResult(True, "chooser", "Steam account chooser already visible")

    restarted = restart_to_account_chooser()
    if not restarted.ok and account_chooser_visible():
        # Steam can keep helper processes alive longer than steam.exe shutdown
        # detection expects while the chooser is already usable. Prefer the
        # observable UI state over a strict process timeout.
        return SteamSwitchResult(True, "chooser", "Steam account chooser is visible")
    if not restarted.ok:
        return restarted

    deadline = time.time() + timeout
    while time.time() < deadline:
        if account_chooser_visible():
            return SteamSwitchResult(True, "chooser", "Steam account chooser detected")
        time.sleep(0.5)
    return SteamSwitchResult(False, "chooser", "Steam account chooser was not detected before timeout")


def list_remembered_accounts(open_chooser: bool = True) -> tuple[SteamSwitchResult, list[RememberedSteamAccount]]:
    if open_chooser:
        ready = ensure_account_chooser()
        if not ready.ok:
            return ready, []
    accounts = remembered_accounts()
    if not accounts:
        return SteamSwitchResult(False, "discover", "No remembered Steam accounts were visible"), []
    return SteamSwitchResult(True, "discover", f"Found {len(accounts)} remembered Steam account(s)"), accounts


def _find_click_text_for_target(target_label: str) -> tuple[str, RememberedSteamAccount] | None:
    target = _normalize(target_label)
    for account in remembered_accounts():
        aliases = {_normalize(account.display_name), _normalize(account.account_name), _normalize(account.label)}
        if target in aliases:
            return account.display_name, account
    return None


def select_remembered_account(account_label: str, timeout: float = 20.0) -> SteamSwitchResult:
    """Click a remembered account already shown in Steam's chooser.

    The target may be either the visible display name or the visible Steam
    account/login name. No username/password entry is attempted.
    """
    target = _normalize(account_label)
    if not target:
        return SteamSwitchResult(False, "select", "No remembered account label was supplied")

    chooser = ensure_account_chooser(timeout=timeout)
    if not chooser.ok:
        return chooser

    deadline = time.time() + timeout
    while time.time() < deadline:
        matched = _find_click_text_for_target(account_label)
        if not matched:
            time.sleep(0.4)
            continue
        click_text, account = matched
        click_target = _normalize(click_text)

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
                if _normalize(text) != click_target:
                    continue
                try:
                    ctrl.iface_invoke.Invoke()
                    return SteamSwitchResult(True, "select", f"Selected Steam account: {account.label}")
                except Exception:
                    pass
                try:
                    ctrl.click_input()
                    return SteamSwitchResult(True, "select", f"Selected Steam account: {account.label}")
                except Exception as exc:
                    return SteamSwitchResult(False, "select", f"Found account card but could not click it: {exc}")
        time.sleep(0.4)

    visible = remembered_accounts()
    sample = ", ".join(account.label for account in visible) if visible else "<no remembered accounts visible>"
    return SteamSwitchResult(
        False,
        "select",
        f"Remembered account '{account_label}' was not found in Steam's visible chooser. Visible accounts: {sample}",
    )


def switch_to_remembered_account(account_label: str) -> SteamSwitchResult:
    """Open/reuse Steam's account chooser and select one remembered account."""
    ready = ensure_account_chooser()
    if not ready.ok:
        return ready
    return select_remembered_account(account_label)
