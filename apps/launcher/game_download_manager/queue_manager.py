"""The download queue: the one place that decides which downloads run, wait, pause or resume.

The desktop app only sends orders (enqueue, pause, resume, cancel, move, remove) and shows the state; Rust only
starts this process. Every download still runs in its own worker process (`digital_downloader.py`); this module
starts, pauses and stops those workers and reads their status files.

Rules (the plan comes from the app with its activation):
- BASE runs 1 download at a time, PLUS 4. A paused download does not take a place: pausing one lets the next
  queued one start, and resuming a paused one waits for a free place.
- The queue order is the start order; queued downloads can be moved up or down.
- BASE downloads only torrents (a direct link needs PLUS).
- Closing the app stops the workers without deleting anything; the downloads that were running resume when the
  app opens again (each transfer resumes from what is on disk). User-paused downloads stay paused.
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol

ACTIVE_PHASES = ("preparing", "downloading", "decompressing", "installing", "cancelling")
TERMINAL_PHASES = ("completed", "error", "cancelled", "interrupted", "external")
STALE_SECONDS = 20.0          # an active worker that has not written its status for this long has stopped
LIMITS = {"base": 1, "plus": 4}


class QueueError(ValueError):
    """An order the queue refuses; the message is shown to the player."""


@dataclass
class Job:
    app_id: int
    name: str
    source: str
    delivery: str = "download"
    auto_installed: bool = False
    keep_archive: bool = False
    source_title: str = ""      # the download as its source names it, kept with the install (two downloads can differ)
    source_provider: str = ""
    # waiting: queued for a place; active: a worker is moving data (the only state that takes a place);
    # paused: the player paused it; cancelling: its worker is winding down; done: finished
    state: str = "waiting"
    worker_alive: bool = False   # a worker process exists for it (also while paused)
    phase: str = "queued"        # what the player sees, from the worker's status when there is one
    status: dict = field(default_factory=dict)
    error: str = ""


class Workers(Protocol):
    def start(self, job: Job, chunk_session: str | None) -> None: ...
    def control(self, app_id: int, action: str) -> None: ...
    def stop(self, app_id: int) -> None: ...
    def status(self, app_id: int) -> tuple[dict | None, float | None]: ...  # (status, seconds since written)
    def alive(self, app_id: int) -> bool: ...


def is_torrent(source: str) -> bool:
    value = source.strip().lower()
    return value.startswith("magnet:") or value.split("?")[0].endswith(".torrent")


class DownloadQueue:
    def __init__(self, workers: Workers, state_file: Path | None = None, clock=time.monotonic):
        self.workers = workers
        self.state_file = state_file
        self.clock = clock
        self.tier: str | None = None
        self.chunk_session: str | None = None
        self.jobs: dict[int, Job] = {}
        self.order: list[int] = []   # queue order of waiting jobs (first starts first)
        self.lock = threading.RLock()

    # ------------------------------------------------------------------ configuration
    @property
    def limit(self) -> int:
        return LIMITS.get(self.tier or "", 0)

    def configure(self, tier: str | None, chunk_session: str | None) -> None:
        """The plan and the server session (PLUS) the app is activated with; without a plan nothing starts."""
        with self.lock:
            self.tier = tier if tier in LIMITS else None
            self.chunk_session = chunk_session or None
            self.pump()

    def suspend(self) -> None:
        """The activation ended: nothing runs or starts until a plan is configured again; pending downloads pause."""
        with self.lock:
            self.tier, self.chunk_session = None, None
            for job in self.jobs.values():
                if job.state == "active":
                    self.workers.control(job.app_id, "pause")
                    job.state = "paused"
                elif job.state == "waiting":
                    job.state, job.phase = "paused", "paused"
            self.order.clear()
            self._save()

    # ------------------------------------------------------------------ orders
    def enqueue(self, app_id: int, name: str, source: str, delivery: str = "download",
                auto_installed: bool = False, keep_archive: bool = False, source_title: str = "",
                source_provider: str = "") -> Job:
        with self.lock:
            source = (source or "").strip()
            if not source:
                raise QueueError(f"El juego '{name}' no tiene fuentes de descarga disponibles.")
            if self.tier != "plus" and source.lower().startswith(("http://", "https://")) and not is_torrent(source) and delivery != "browser":
                raise QueueError(f"El modo gratuito descarga solo por torrent. '{name}' no tiene un torrent disponible; con Plus también se aceptan enlaces directos.")
            current = self.jobs.get(app_id)
            if current and current.state != "done":
                return current  # already queued or running: asking again changes nothing
            job = Job(app_id=app_id, name=name, source=source, delivery=delivery or "download",
                      auto_installed=auto_installed, keep_archive=keep_archive,
                      source_title=source_title or "", source_provider=source_provider or "")
            self.jobs[app_id] = job
            self.order.append(app_id)
            self.pump()
            return job

    def pause(self, app_id: int) -> None:
        with self.lock:
            job = self._job(app_id)
            if job.state == "waiting":
                self.order.remove(app_id)
                job.state, job.phase = "paused", "paused"
            elif job.state == "active":
                self.workers.control(app_id, "pause")
                job.state = "paused"  # its place goes to the next one; the worker confirms "paused" in its status
                self.pump()
            self._save()

    def resume(self, app_id: int) -> None:
        with self.lock:
            job = self._job(app_id)
            if job.state != "paused":
                return
            if self.tier != "plus" and job.delivery != "browser" and job.source.lower().startswith(("http://", "https://")) and not is_torrent(job.source):
                # PLUS ended (or the app is in free mode): a direct link waits paused until PLUS is back.
                raise QueueError(f"El modo gratuito descarga solo por torrent. '{job.name}' es un enlace directo: se reanuda con Plus.")
            job.state, job.phase = "waiting", "queued"
            self.order.append(app_id)
            self.pump()

    def cancel(self, app_id: int) -> None:
        with self.lock:
            job = self._job(app_id)
            if job.state == "done":
                return
            if app_id in self.order:
                self.order.remove(app_id)
            if job.worker_alive:
                self.workers.control(app_id, "cancel")  # the worker removes what it downloaded and reports "cancelled"
                job.state, job.phase = "cancelling", "cancelling"  # takes no place while it winds down
            else:
                self._finish(job, "cancelled")
            self.pump()

    def move(self, app_id: int, delta: int) -> None:
        with self.lock:
            if app_id not in self.order:
                return
            index = self.order.index(app_id)
            target = max(0, min(len(self.order) - 1, index + delta))
            self.order.insert(target, self.order.pop(index))
            self._save()

    def remove(self, app_id: int) -> None:
        """Forget a finished download (its row in the history)."""
        with self.lock:
            job = self.jobs.get(app_id)
            if job is None:
                return
            if job.state != "done":
                raise QueueError("Cancelá la descarga antes de quitarla de la lista.")
            del self.jobs[app_id]
            self._save()

    # ------------------------------------------------------------------ scheduling
    def running(self) -> int:
        return sum(1 for job in self.jobs.values() if job.state == "active")

    def pump(self) -> None:
        """Start (or resume) waiting downloads while there are free places."""
        with self.lock:
            while self.order and self.running() < self.limit:
                job = self.jobs[self.order.pop(0)]
                job.state, job.error = "active", ""
                if job.worker_alive:
                    self.workers.control(job.app_id, "resume")
                else:
                    job.phase, job.status = "preparing", {}
                    try:
                        self.workers.start(job, self.chunk_session if self.tier == "plus" else None)
                        job.worker_alive = True
                    except Exception as exc:  # noqa: BLE001 - shown to the player
                        self._finish(job, "error", f"No se pudo iniciar la descarga: {exc}")
            self._save()

    def tick(self) -> None:
        """Read every worker's status: follow its phase, notice when it ends or stops answering."""
        with self.lock:
            for job in list(self.jobs.values()):
                if not job.worker_alive:
                    continue
                status, age = self.workers.status(job.app_id)
                if status:
                    job.status = status
                    phase = str(status.get("phase") or "")
                    if phase in TERMINAL_PHASES:
                        self._finish(job, phase, str(status.get("error") or ""))
                        continue
                    if job.state != "waiting":
                        job.phase = phase or job.phase
                if not self.workers.alive(job.app_id):
                    self._finish(job, "interrupted", "El proceso de descarga se cerró sin terminar. Reintentá la descarga.")
                elif job.state == "active" and age is not None and age > STALE_SECONDS:
                    self.workers.stop(job.app_id)
                    self._finish(job, "interrupted", "El motor dejó de actualizar su estado. Reintentá la descarga.")
            self.pump()

    def _finish(self, job: Job, phase: str, error: str = "") -> None:
        job.state, job.phase, job.worker_alive = "done", phase, False
        job.error = error
        if job.app_id in self.order:
            self.order.remove(job.app_id)

    def _job(self, app_id: int) -> Job:
        job = self.jobs.get(app_id)
        if job is None:
            raise QueueError("Esa descarga no existe.")
        return job

    # ------------------------------------------------------------------ state
    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "tier": self.tier, "limit": self.limit, "running": self.running(),
                "jobs": [{
                    "appId": job.app_id, "name": job.name, "phase": job.phase, "state": job.state,
                    "position": self.order.index(job.app_id) if job.app_id in self.order else -1,
                    "error": job.error or str(job.status.get("error") or ""), "status": job.status,
                    "route": str(job.status.get("route") or ""),
                } for job in self.jobs.values()],
            }

    def _save(self) -> None:
        if self.state_file is None:
            return
        pending = [job for job in self.jobs.values() if job.state not in ("done", "cancelling")]  # a cancel is never resumed
        data = {"order": [i for i in self.order if i in self.jobs],
                "jobs": [{**asdict(job), "status": {}} for job in pending]}
        temp = self.state_file.with_suffix(".tmp")
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            temp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(temp, self.state_file)
        except OSError:
            pass

    def restore(self) -> None:
        """At start: downloads that were running wait again (first, in their order); paused ones stay paused."""
        if self.state_file is None:
            return
        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        with self.lock:
            resumed: list[int] = []
            for raw in data.get("jobs", []):
                try:
                    job = Job(**{k: v for k, v in raw.items() if k in Job.__dataclass_fields__})
                except TypeError:
                    continue
                job.worker_alive, job.status, job.error = False, {}, ""
                if job.state == "paused":
                    job.phase = "paused"
                else:
                    if job.state == "active":
                        resumed.append(job.app_id)
                    job.state, job.phase = "waiting", "queued"
                self.jobs[job.app_id] = job
            waiting = [i for i in data.get("order", []) if i in self.jobs and self.jobs[i].state == "waiting"]
            rest = [i for i, job in self.jobs.items() if job.state == "waiting" and i not in resumed and i not in waiting]
            self.order = resumed + [i for i in waiting if i not in resumed] + rest
            self._save()

    def shutdown(self) -> None:
        """The app is closing: stop every worker (nothing is deleted) and remember what to resume."""
        with self.lock:
            for job in self.jobs.values():
                if job.worker_alive:
                    self.workers.stop(job.app_id)
            self._save()
