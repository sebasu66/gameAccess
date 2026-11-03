"""The import scan as it goes: the folder being read and the games found so far, written to a small file the app reads
while the scan runs (as freezes do, see freeze_control.py), and the player's "Stop", a file the app writes."""
from __future__ import annotations
import json
import time
from pathlib import Path
from atomic_json import write_json

# The app polls a few times a second: writing more often only costs disk.
WRITE_EVERY = 0.25


class ScanCancelled(Exception):
    """The player stopped the scan: what was found so far is still offered."""


class ScanReport:
    """Without a folder (tests, the CLI) it only answers that nobody asked to stop."""

    def __init__(self, folder: Path | None = None):
        self.dir = Path(folder) if folder else None
        self.state = {"folder": "", "folders": 0, "found": [], "done": False, "cancelled": False, "started": time.time()}
        self._written = 0.0
        if self.dir:
            self.dir.mkdir(parents=True, exist_ok=True)
            (self.dir / "cancel").unlink(missing_ok=True)
            self._write(force=True)

    @property
    def progress_file(self) -> Path | None:
        return self.dir / "progress.json" if self.dir else None

    def cancelled(self) -> bool:
        return bool(self.dir) and (self.dir / "cancel").exists()

    def folder(self, path) -> None:
        """Entering a folder; raises ScanCancelled once the player asked to stop."""
        self.state["folder"] = str(path)
        self.state["folders"] += 1
        self._write()
        if self.cancelled():
            raise ScanCancelled()

    def found(self, game: dict) -> None:
        self.state["found"].append({key: game.get(key) for key in ("name", "path", "size_bytes", "kind", "app_id")})
        self._write(force=True)

    def finish(self, cancelled: bool = False) -> None:
        self.state.update(done=True, cancelled=cancelled, folder="")
        self._write(force=True)
        if self.dir:
            (self.dir / "cancel").unlink(missing_ok=True)

    def _write(self, force: bool = False) -> None:
        now = time.time()
        if not self.dir or (not force and now - self._written < WRITE_EVERY):
            return
        self._written = now
        try:
            write_json(self.dir / "progress.json", self.state)
        except OSError:
            pass   # the app shows less; the scan goes on


def read(folder: Path) -> dict:
    try:
        return json.loads((Path(folder) / "progress.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
