"""The steps a download goes through, reported to the app as structured data (docs/TAREA-interfaz-nueva.md T12).

The app shows them as a sequence so the player can see why a download takes time to start:
route (does the server already have it?), probe (how fast is the torrent?), server (the server prepares it),
download, extract and install. The pipeline names the decisions (route, probe, server); the phases of the
progress events move the rest along on their own. `statusText` stays as it was for older readers.
"""
import time

ORDER = ("route", "probe", "server", "download", "extract", "install")
_PHASE_STEP = {"downloading": "download", "decompressing": "extract", "installing": "install"}
_DEFAULT_RESULT = {"server": "Listo en el servidor", "download": "Descargado", "extract": "Descomprimido", "install": "Instalado"}


class StepTracker:
    def __init__(self, clock=time.time):
        self._clock = clock
        self.current = None
        self.done = {}

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

    def detail(self, text):
        if self.current and text:
            self.current["detail"] = text

    def finish(self, result="", state="done"):
        current, self.current = self.current, None
        if current:
            fallback = _DEFAULT_RESULT.get(current["id"], current["detail"])
            self.done[current["id"]] = {"id": current["id"], "state": state, "result": result or fallback, "ms": self._now() - current["startedAt"]}

    def skip(self, step_id, result=""):
        if step_id not in self.done and not (self.current and self.current["id"] == step_id):
            self.done[step_id] = {"id": step_id, "state": "skipped", "result": result, "ms": 0}

    def fail(self, message):
        if self.current:
            self.finish(message, "failed")

    def follow(self, phase, status_text=""):
        """Moves the sequence along from a progress event."""
        if self.current and self.current["id"] == "probe" and phase in ("preparing", "downloading"):
            # While the torrent is measured it already downloads: that is still the measuring step.
            self.detail(status_text)
            return
        step_id = _PHASE_STEP.get(phase)
        if step_id and not (self.current and self.current["id"] == step_id):
            if step_id == "download":
                for earlier in ("route", "probe", "server"):
                    if not (self.current and self.current["id"] == earlier):
                        self.skip(earlier)
            self.start(step_id, status_text)
            return
        if phase == "completed":
            self.finish()
            for step in ORDER:
                self.skip(step)
            return
        self.detail(status_text)

    def payload(self):
        return {
            "step": dict(self.current) if self.current else None,
            "steps": [self.done[step] for step in ORDER if step in self.done],
        }
