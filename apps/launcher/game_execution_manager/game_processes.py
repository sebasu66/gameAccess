"""A game that hung (a window that does not answer, a process left behind by a crash) keeps the next launch from working:
the new one finds the old one holding its files, its port or its single-instance lock. These find the processes that run
from a game's folders and close them, so the automatic fix starts from a clean slate."""
from __future__ import annotations
import json
import subprocess
import sys
from pathlib import Path

_HIDDEN = 0x08000000


def game_folders(folder: Path | None, linked_record: dict | None = None, app_id: int | None = None, steam=None) -> list[Path]:
    """Where the game may run from: its own folder, a linked game's folder and, for Steam, every folder Steam has it in
    (Steam runs it where it installed it, which may not be where Game Access recorded it)."""
    found: list[Path] = []
    if folder:
        found.append(Path(folder))
    if linked_record and linked_record.get("path"):
        found.append(Path(linked_record["path"]))
    if steam is not None and app_id:
        try:
            found.extend(Path(game.folder) for game in steam.installed_all() if game.app_id == int(app_id))
        except Exception:  # noqa: BLE001 - Steam's files unreadable: the other folders still count
            pass
    unique: list[Path] = []
    for item in found:
        if item and str(item).strip() and item not in unique:
            unique.append(item)
    return unique


def running_in(folders: list[Path]) -> list[dict]:
    """Processes whose executable is inside one of `folders`: [{pid, name, path, responding}]."""
    roots = [str(folder).rstrip("\\/") for folder in folders if str(folder).strip()]
    if sys.platform != "win32" or not roots:
        return []
    quoted = ",".join("'" + root.replace("'", "''") + "'" for root in roots)
    script = ("$f=@(" + quoted + "); Get-Process | Where-Object { $_.Path } | ForEach-Object { $p=$_.Path; "
              "foreach($x in $f){ if($p.StartsWith($x + '\\', [StringComparison]::OrdinalIgnoreCase)){ "
              "[pscustomobject]@{pid=$_.Id;name=$_.ProcessName;path=$p;responding=[bool]$_.Responding}; break } } } | ConvertTo-Json -Compress")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, timeout=25, creationflags=_HIDDEN).stdout.decode("utf-8", "replace").strip()
        data = json.loads(out) if out else []
    except (OSError, subprocess.SubprocessError, ValueError):
        return []
    return [data] if isinstance(data, dict) else list(data)


def close_all(processes: list[dict]) -> tuple[list[str], list[str]]:
    """Ends each process with its children (taskkill /F /T). Returns (closed names, names that would not close: a
    process running as administrator cannot be ended from here)."""
    closed: list[str] = []
    failed: list[str] = []
    for process in processes:
        done = subprocess.run(["taskkill", "/PID", str(int(process["pid"])), "/F", "/T"], capture_output=True, timeout=20, creationflags=_HIDDEN)
        # Already gone (it ended while the others were being closed) is also fine: 128 = "no such process".
        (closed if done.returncode in (0, 128) else failed).append(str(process.get("name", process["pid"])))
    return closed, failed
