"""The library manager's "does this game run here?" verdicts: `.cache/run_checks/<appid>.json`, one per game.
`checked`: it was started, stayed open and was closed again. `cantRun`: it did not start, closed on its own or never
showed up, with the reason. The verdict is a record of one try on this PC, not a promise."""
from __future__ import annotations
import time

from atomic_json import write_json
from launcher_data import data_dir
import json

CHECKED = "checked"
CANT_RUN = "cantRun"


class RunChecks:
    def __init__(self, launcher):
        self.dir = data_dir(launcher) / ".cache" / "run_checks"

    def path(self, app_id):
        return self.dir / f"{int(app_id)}.json"

    def get(self, app_id):
        if app_id is None:
            return None
        try:
            return json.loads(self.path(app_id).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def save(self, app_id, state, detail="", seconds=0.0, problems=None):
        record = {"state": state, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "detail": str(detail)[:400], "seconds": round(float(seconds), 1),
                  "problems": list(problems or [])[:8]}
        write_json(self.path(app_id), record)
        return record

    def forget(self, app_id):
        self.path(app_id).unlink(missing_ok=True)
