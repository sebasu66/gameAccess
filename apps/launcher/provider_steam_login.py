from __future__ import annotations

import argparse
import json
import os
import re
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


def _wait_login(log: Path, offset: int, account: str, timeout: float) -> str:
    """Observe only fresh, account-specific Steam UI login events, never tokens."""
    pattern = re.compile(
        r"Login: OnLoginStateChange " + re.escape(account) + r" (\d+) (\d+) ",
        re.IGNORECASE,
    )
    deadline = time.monotonic() + timeout
    pending = b""
    while time.monotonic() < deadline:
        try:
            if log.stat().st_size < offset:
                offset = 0
                pending = b""
            with log.open("rb") as handle:
                handle.seek(offset)
                pending += handle.read()
                offset = handle.tell()
            lines = pending.split(b"\n")
            pending = lines.pop()
            for line in lines:
                match = pattern.search(line.decode("utf-8", errors="replace"))
                if match:
                    state, result = map(int, match.groups())
                    if state == 5 and result == 1:
                        return "ok"
                    if state == 1 and result != 1:
                        return "session_conflict" if result in {6, 49, 50} else "login_failed"
        except OSError:
            pass
        time.sleep(0.5)
    return "timeout"


def login_credentials(account: str, password: str, *, timeout_seconds: float = 45) -> dict:
    """Try silent startup, then one visible startup; launching is not success."""
    steam = _find_steam_exe()
    log = steam.parent / "logs" / "webhelper_js.txt"
    attempts = []
    for silent in (True, False):
        _stop_steam(steam)
        if _steam_running():
            raise RuntimeError("Steam did not close before login retry")
        offset = log.stat().st_size if log.exists() else 0
        subprocess.Popen(
            [str(steam), *(["-silent"] if silent else []), "-login", account, password],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=_creationflags(),
        )
        status = _wait_login(log, offset, account, timeout_seconds)
        attempts.append({"mode": "silent" if silent else "visible", "status": status})
        if status == "ok":
            return {"ok": True, "mode": attempts[-1]["mode"], "attempts": attempts}
        if status == "session_conflict":
            break  # Occupied is temporary; never try to displace another session.
    return {"ok": False, "status": status, "attempts": attempts}


def login(provider_id: str) -> dict:
    credential = credential_by_provider_id(provider_id)
    if credential is None:
        raise RuntimeError(f"Provider account not found: {provider_id}")
    return login_credentials(credential.login, credential.password)


def main() -> int:
    parser = argparse.ArgumentParser(description="Log Steam into one GameAccess provider account")
    parser.add_argument("provider_id")
    args = parser.parse_args()
    result = login(args.provider_id)
    print(json.dumps(result))
    return 0 if result["ok"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
