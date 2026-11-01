"""What a Play is doing, live. While a game starts, every line the launcher's logger writes is also kept in
`.cache/digital_launch/<appid>-progress.json`; the desktop reads that file a few times a second (`launch_progress`) to
fill the launch dialog's live log. `diagnose` answers the dialog's error mode: what could keep the game from opening."""
from __future__ import annotations
import logging
import re
import subprocess
import sys
import time
from pathlib import Path
from atomic_json import write_json
from launcher_data import data_dir
from game_paths import MAX_PATH, SAFE_ROOT_LENGTH, longest_inside
from .game_options import supports_language

MAX_LINES = 160
_PLAIN = re.compile(r"^[A-Za-z0-9 _.\-:\/()\[\]'&,+!]+$")
_HIDDEN = 0x08000000  # CREATE_NO_WINDOW


def progress_path(launcher, app_id) -> Path:
    return data_dir(launcher) / ".cache" / "digital_launch" / f"{int(app_id)}-progress.json"


class LaunchTrace(logging.Handler):
    """Mirrors the logger into the progress file for as long as it is attached."""

    def __init__(self, path: Path, logger: logging.Logger):
        super().__init__(logging.INFO)
        self.path, self.logger = path, logger
        self.state = {"started_at": time.time(), "lines": [], "finished": False, "ok": None, "error": ""}

    def __enter__(self):
        self.logger.addHandler(self)
        self.add("Play requested")
        return self

    def __exit__(self, *_):
        self.logger.removeHandler(self)
        return False

    def add(self, text: str, level: str = "INFO") -> None:
        lines = self.state["lines"]
        lines.append({"at": round(time.time() - self.state["started_at"], 2), "level": level, "text": str(text)[:400]})
        del lines[:-MAX_LINES]
        self.save()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.add(record.getMessage(), record.levelname)
        except Exception:
            pass

    def finish(self, ok: bool, error: str = "") -> None:
        self.state.update(finished=True, ok=ok, error=error)
        self.save()

    def save(self) -> None:
        try:
            write_json(self.path, self.state)
        except OSError:
            pass


def steam_running() -> bool:
    if sys.platform != "win32":
        return False
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"], capture_output=True, text=True, timeout=6, creationflags=_HIDDEN).stdout
        return "steam.exe" in out.lower()
    except (OSError, subprocess.SubprocessError):
        return False


def defender_threats(folder: Path) -> list[str]:
    """Files under `folder` that Windows Defender detected (and so possibly removed); [] when none or unreadable."""
    if sys.platform != "win32":
        return []
    script = ("Get-MpThreatDetection | ForEach-Object { $_.Resources } | Where-Object { $_ -like '*" + str(folder).replace("'", "''") + "*' } "
              "| Select-Object -First 5")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=12, creationflags=_HIDDEN).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def diagnose(folder: Path, steam: bool, steam_game: bool, backups_present: bool, frozen: str = "") -> list[dict]:
    """The checks the error mode shows. `ok` False is a likely cause; True passed; None could not be checked."""
    checks: list[dict] = []
    text = str(folder)
    longest = longest_inside(folder) if folder.is_dir() else 0
    total = len(text) + 1 + longest
    checks.append({"id": "path_length", "ok": total <= MAX_PATH and len(text) <= SAFE_ROOT_LENGTH + 40, "length": total, "limit": MAX_PATH})
    checks.append({"id": "path_symbols", "ok": bool(_PLAIN.match(text)), "path": text})
    if steam:
        checks.append({"id": "steam_running", "ok": steam_running()})
    missing = ""
    marker = folder / ".gameaccess_exe"
    if marker.is_file():
        try:
            relative = marker.read_text(encoding="utf-8").strip()
            if relative and not (folder / relative).is_file():
                missing = relative
        except OSError:
            pass
    threats = defender_threats(folder) if folder.is_dir() else []
    checks.append({"id": "antivirus", "ok": not missing and not threats, "missing": missing, "threats": threats})
    from .runtimes import missing_runtimes, video_driver
    lacking = missing_runtimes(folder) if folder.is_dir() else []
    checks.append({"id": "runtimes", "ok": not lacking, "missing": [f"{item['id']} {item['arch']}" for item in lacking]})
    driver = video_driver()
    if driver:
        checks.append({"id": "gpu_driver", "ok": not driver["old"], **driver})
    if backups_present:
        checks.append({"id": "language_forced", "ok": False})
    if frozen:
        checks.append({"id": "frozen", "ok": False, "level": frozen})
    return checks
