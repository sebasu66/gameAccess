"""The steps a download goes through, reported to the app as structured data (docs/TAREA-interfaz-nueva.md T12).

The app shows them as a sequence so the player can see why a download takes time to start:
pick (several torrents race and the fastest goes on), route (does the server already have it?), probe (how fast is the torrent?), server (the server prepares it),
download, extract and install. The pipeline names the decisions (route, probe, server); the phases of the
progress events move the rest along on their own. `statusText` stays as it was for older readers.
"""
import time

from game_download_manager.ui_text import ui

ORDER = ("pick", "route", "probe", "server", "download", "extract", "install")
# A free Steam game (steam_depot): Steam's own install window, then Steam downloads it. No source, route or
# unpacking: those steps do not exist for it. Through DepotDownloader (depot_tool_download): sign in to Steam,
# download, hand it to the Steam library, Steam takes it in.
STEAM_ORDER = ("dialog", "download")
DEPOT_ORDER = ("signin", "download", "handoff", "adopt")
_PHASE_STEP = {"downloading": "download", "decompressing": "extract", "installing": "install"}
_DEFAULT_RESULT = {"server": ui("dlDoneServer"), "download": ui("dlDoneDownload"), "extract": ui("dlDoneExtract"), "install": ui("dlDoneInstall")}


class StepTracker:
    def __init__(self, clock=time.time):
        self._clock = clock
        self.current = None
        self.done = {}
        self.order = ORDER
        self.phase_step = _PHASE_STEP
        self.waiting_facts = {}

    def facts(self, values, step_id=None):
        """What a step works with, for the player to see in it (folder, disk, free and needed space, account…). For a
        step not started yet they wait for it; a finished or failed one keeps them."""
        values = {key: value for key, value in (values or {}).items() if value not in (None, "")}
        if not values:
            return
        if step_id is None or (self.current and self.current["id"] == step_id):
            if self.current:
                self.current.setdefault("facts", {}).update(values)
            return
        if step_id in self.done:
            self.done[step_id].setdefault("facts", {}).update(values)
            return
        self.waiting_facts.setdefault(step_id, {}).update(values)

    def steam(self, kind="client"):
        """The steps of a free Steam game; the pipeline names each one, only the download follows the progress."""
        self.order = DEPOT_ORDER if kind == "depot" else STEAM_ORDER
        self.phase_step = {"downloading": "download"}

    def _now(self):
        return int(self._clock() * 1000)

    def start(self, step_id, detail=""):
        if self.current and self.current["id"] == step_id:
            self.detail(detail)
            return
        if self.current:
            self.finish()
        self.done.pop(step_id, None)
        self.current = {"id": step_id, "detail": detail, "startedAt": self._now()}
        if step_id in self.waiting_facts:
            self.current["facts"] = self.waiting_facts.pop(step_id)

    def detail(self, text):
        if self.current and text:
            self.current["detail"] = text

    def finish(self, result="", state="done"):
        current, self.current = self.current, None
        if current:
            fallback = _DEFAULT_RESULT.get(current["id"], current["detail"])
            self.done[current["id"]] = {"id": current["id"], "state": state, "result": result or fallback, "ms": self._now() - current["startedAt"],
                                        **({"facts": current["facts"]} if current.get("facts") else {})}

    def skip(self, step_id, result=""):
        if step_id not in self.done and not (self.current and self.current["id"] == step_id):
            self.done[step_id] = {"id": step_id, "state": "skipped", "result": result, "ms": 0}

    def fail(self, message):
        if self.current:
            self.finish(message, "failed")

    def follow(self, phase, status_text=""):
        """Moves the sequence along from a progress event."""
        if self.current and self.current["id"] in ("pick", "probe") and phase in ("preparing", "downloading"):
            # While the torrents race or one is measured they already download: that is still that step.
            self.detail(status_text)
            return
        step_id = self.phase_step.get(phase)
        if step_id and not (self.current and self.current["id"] == step_id):
            if step_id == "download" and self.order is ORDER:
                for earlier in ("route", "probe", "server"):
                    if not (self.current and self.current["id"] == earlier):
                        self.skip(earlier)
            self.start(step_id, status_text)
            return
        if phase == "completed":
            self.finish()
            for step in self.order:
                if step != "pick":  # shown only when torrents raced
                    self.skip(step)
            return
        self.detail(status_text)

    def payload(self):
        return {
            "step": {**self.current, **({"facts": dict(self.current["facts"])} if self.current.get("facts") else {})} if self.current else None,
            "steps": [self.done[step] for step in self.order if step in self.done],
        }
