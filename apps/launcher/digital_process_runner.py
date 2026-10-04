from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def run_process(action: str, app_id: int, name: str, command: str, working_dir: str | None = None) -> dict:
    if not command or not command.strip():
        return {
            "ok": False,
            "action": action,
            "app_id": app_id,
            "error": f"No {action} command specified.",
        }

    cmd = command.strip()
    cwd = Path(working_dir).resolve() if working_dir and Path(working_dir).exists() else None

    # On Windows, using shell=True allows executing command sequences, batch files,
    # powershell commands, or direct executables seamlessly.
    try:
        if action == "play":
            # For game launching, start detached so the game process keeps running independently.
            flags = 0
            if sys.platform == "win32":
                flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000008  # DETACHED_PROCESS

            proc = subprocess.Popen(
                cmd,
                shell=True,
                cwd=str(cwd) if cwd else None,
                creationflags=flags,
                close_fds=True,
            )
            return {
                "ok": True,
                "action": "play",
                "app_id": app_id,
                "name": name,
                "pid": proc.pid,
                "command": cmd,
            }
        elif action == "uninstall":
            # For uninstalling, wait for completion to know if files were successfully cleaned.
            result = subprocess.run(
                cmd,
                shell=True,
                cwd=str(cwd) if cwd else None,
                capture_output=True,
                text=True,
                timeout=600,
            )
            return {
                "ok": result.returncode == 0,
                "action": "uninstall",
                "app_id": app_id,
                "name": name,
                "exit_code": result.returncode,
                "stdout": result.stdout.strip(),
                "stderr": result.stderr.strip(),
                "command": cmd,
            }
        else:
            return {
                "ok": False,
                "action": action,
                "app_id": app_id,
                "error": f"Unknown action '{action}'",
            }
    except Exception as exc:
        return {
            "ok": False,
            "action": action,
            "app_id": app_id,
            "name": name,
            "error": str(exc),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Digital Game Process Runner")
    parser.add_argument("--action", choices=["play", "uninstall"], required=True)
    parser.add_argument("--app-id", type=int, required=True)
    parser.add_argument("--name", type=str, default="")
    parser.add_argument("--command", type=str, required=True, help="Command sequence to execute in the terminal")
    parser.add_argument("--working-dir", type=str, default=None, help="Working directory for the process")
    args = parser.parse_args()

    result = run_process(
        action=args.action,
        app_id=args.app_id,
        name=args.name,
        command=args.command,
        working_dir=args.working_dir,
    )

    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
