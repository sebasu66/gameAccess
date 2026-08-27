"""Run a Steam client console command and capture only the newly appended console log.

No credentials are read or injected. The command executes in the already signed-in
Steam client. Output comes from Steam's own logs/console_log.txt.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

from steam_switch import find_steam_exe
from steam_pool import active_user_id32, remembered_account_identities


def active_identity() -> dict | None:
    active = active_user_id32()
    return next((item for item in remembered_account_identities() if item.get("user_id32") == active), None)


def run_console_command(parts: list[str], wait_seconds: float = 3.0) -> dict:
    steam = find_steam_exe()
    if not steam:
        raise RuntimeError("Steam executable not found")
    log_path = steam.parent / "logs" / "console_log.txt"
    start = log_path.stat().st_size if log_path.is_file() else 0

    argv = [str(steam), "steam://open/console/", "+log_files_always_flush", "1"]
    if parts:
        argv.append("+" + parts[0])
        argv.extend(parts[1:])
    subprocess.Popen(argv, close_fds=True)

    deadline = time.time() + wait_seconds
    last_size = start
    stable_since = None
    while time.time() < deadline:
        time.sleep(0.25)
        size = log_path.stat().st_size if log_path.is_file() else 0
        if size != last_size:
            last_size = size
            stable_since = time.time()
        elif stable_since and time.time() - stable_since > 0.75:
            break

    data = b""
    if log_path.is_file():
        with log_path.open("rb") as handle:
            if start <= log_path.stat().st_size:
                handle.seek(start)
            data = handle.read()
    text = data.decode("utf-8", errors="replace")
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    return {
        "active_user_id32": active_user_id32(),
        "active_identity": active_identity(),
        "command": " ".join(parts),
        "new_log_bytes": len(data),
        "lines": lines[-300:],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs=argparse.REMAINDER)
    parser.add_argument("--wait", type=float, default=4.0)
    args = parser.parse_args()
    if not args.command:
        parser.error("command required")
    result = run_console_command(args.command, args.wait)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
