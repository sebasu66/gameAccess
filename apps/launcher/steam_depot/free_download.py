"""A free Steam game (free to play, a free demo) brought by DepotDownloader into the player's Steam library.

Who signs in: the accounts Steam remembers on this PC (the same ones Game Access switches to for playing), the most
recent first. DepotDownloader uses the token it saved for that account name; when it has none it would ask for the
password, which Game Access never gives: that account is skipped. When no remembered account works, a QR code is
shown for the player to scan in the Steam app (DepotDownloader then remembers that account).

Where it goes: the Steam library with room for it (the client's own first), in Steam's folder for the game; the
appmanifest names the account as its LastOwner, so Play switches Steam to that account (steam_account_manager).
When Steam does not give the game this way (not free for these accounts, no access), DepotUnavailable says so and
the app offers Steam's own install.
"""
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from steam_depot import depot_tool, steam_library_handoff as handoff


class DepotUnavailable(RuntimeError):
    """Steam does not give this game to these accounts through DepotDownloader: Steam's own install is the way."""


class DepotFailed(RuntimeError):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


@dataclass
class Account:
    steam_id64: str
    account_name: str
    most_recent: bool = False


# run(argv, on_line) -> exit code; on_line returns False to stop the process at once (it asked for a password).
Runner = Callable[[list[str], Callable[[str], bool]], int]


def run_process(argv: list[str], on_line: Callable[[str], bool]) -> int:
    """DepotDownloader with no input: it can never wait on a password typed into it."""
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, encoding="utf-8", errors="replace", bufsize=1,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    assert process.stdout is not None
    for line in process.stdout:
        if on_line(line) is False:
            process.kill()
            break
    return process.wait()


def choose_library(libraries: Iterable[Path], needed_bytes: int = 0, free=None) -> Path:
    """The first Steam library (`<library>`, not `steamapps`) with room for the game; the client's own when none says."""
    found = [Path(item).parent if Path(item).name.lower() == "steamapps" else Path(item) for item in libraries]
    if not found:
        raise DepotFailed("no_library", "Steam has no library on this PC")
    free = free or shutil.disk_usage
    for library in found:
        try:
            if free(library).free > needed_bytes:
                return library
        except OSError:
            continue
    raise DepotFailed("no_space", "No Steam library has room for this game")


def ordered(accounts: Iterable[Account]) -> list[Account]:
    return sorted(accounts, key=lambda account: not account.most_recent)


def download_free_game(app_id: int, name: str, *, accounts: Iterable[Account], libraries: Iterable[Path],
                       installdir: str | None = None, tool: Path | None = None, runner: Runner = run_process,
                       on_progress: Callable[[float, str], None] = lambda percent, file: None,
                       on_status: Callable[[str, dict], None] = lambda event, info: None,
                       login_id: int = depot_tool.LOGIN_ID_BASE, needed_bytes: int = 0) -> dict:
    """Downloads the game and hands it to Steam. `on_status` hears "account" (trying one), "qr" (lines to show),
    "handoff" (writing the manifest). Returns where it went and with which account."""
    tool = tool or depot_tool.ensure_tool()
    library = choose_library(libraries, needed_bytes)
    folder_name = installdir or handoff.safe_installdir(name)
    target = handoff.game_dir(library, folder_name)
    target.mkdir(parents=True, exist_ok=True)
    on_status("target", {"folder": str(target), "library": str(library)})
    tries = [(account, False) for account in ordered(accounts)]
    recent = next(iter(ordered(accounts)), None)
    tries.append((recent, True))           # last: a QR code, for the most recent account (or a new one)
    for account, qr in tries:
        state = depot_tool.DepotState()
        on_status("account", {"account": account.account_name if account else "", "qr": qr})

        def line(text: str, state=state) -> bool:
            event = state.feed(text)
            if event == "progress":
                on_progress(state.percent, state.file)
            elif event == "qr":
                on_status("qr", {"lines": list(state.qr)})
            return event != "login"
        code = runner(depot_tool.command(tool, app_id, target, account=account.account_name if account else None, qr=qr, login_id=login_id), line)
        if state.needs_login or state.failure == "auth":
            continue                       # no saved token for this account (or it expired): the next way to sign in
        if state.failure == "no_access":
            raise DepotUnavailable(f"Steam does not give {name} through DepotDownloader to these accounts")
        if state.failure == "no_space":
            raise DepotFailed("no_space", "The Steam library ran out of space")
        if code != 0:
            raise DepotFailed("exit", f"DepotDownloader stopped (code {code})")
        on_status("handoff", {"library": str(library)})
        size = handoff.finish(target)
        handoff.write_manifest(library, app_id, name, folder_name, size, owner_id64=account.steam_id64 if account else "")
        return {"library": str(library), "folder": str(target), "account": account.account_name if account else "",
                "steam_id64": account.steam_id64 if account else "", "size_bytes": size, "qr": qr}
    raise DepotFailed("login", "No Steam account could sign in")
