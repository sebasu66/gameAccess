"""Resource governor: measures this server's outbound traffic and CPU, approves work that moves bytes, and alerts.

Render bills outbound traffic above the free allowance, so the server keeps its own count for the month (kept in the
shared database, because Render's disk is wiped on each deploy) and refuses work that would pass the budget:
- Every HTTP response is counted by `TrafficCounter` (an ASGI middleware), headers included roughly.
- The piece route that uploads a game to ViKiNG through this server asks `approve(size)` before each piece and
  `release(size, sent)` after it. Remote imports and sealed TorBox links move no bytes here and ask nothing.
- CPU is measured against the share Render gives the container (cgroup `cpu.max`); while it is above the limit,
  pieces wait their turn.
Our count only approximates Render's (encryption and retries are not seen), so work stops at STOP_SHARE of the budget.
Alerts (notify.py) go out at 80 % and at the stop, and when the CPU stays above the limit for 5 minutes.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy import BigInteger, Column
from sqlalchemy.engine import Engine
from sqlmodel import Field as SQLField, Session, SQLModel

from .notify import notify

logger = logging.getLogger("gameaccess.resources")

BUDGET_GB = 10.0          # outbound GB per month (GAMEACCESS_EGRESS_BUDGET_GB)
CPU_LIMIT_PERCENT = 85.0  # of the CPU Render gives the container (GAMEACCESS_CPU_LIMIT_PERCENT)
STOP_SHARE = .9           # work that moves bytes stops here, leaving room for what our count does not see
WARN_SHARE = .8
CPU_ALERT_SECONDS = 300
SAMPLE_SECONDS = 5
FLUSH_SECONDS = 60
HEADER_BYTES = 300        # rough size of a response's status line and headers


class ResourceUsage(SQLModel, table=True):
    """Outbound bytes this server counted, one row per calendar month (UTC)."""

    __tablename__ = "resource_usage"

    month: str = SQLField(primary_key=True, max_length=7)  # "2026-10"
    bytes_out: int = SQLField(default=0, sa_column=Column(BigInteger, nullable=False, default=0))
    updated_at: datetime


def month_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def allowed_cores(root: Path = Path("/sys/fs/cgroup")) -> float:
    """CPU cores the container may use: cgroup v2 cpu.max, then v1 quota/period, else the machine's cores."""
    try:
        quota, period = (root / "cpu.max").read_text().split()[:2]
        if quota != "max":
            return max(int(quota) / int(period), .01)
    except (OSError, ValueError):
        pass
    try:
        quota = int((root / "cpu" / "cpu.cfs_quota_us").read_text())
        period = int((root / "cpu" / "cpu.cfs_period_us").read_text())
        if quota > 0 and period > 0:
            return max(quota / period, .01)
    except (OSError, ValueError):
        pass
    return float(os.cpu_count() or 1)


class Governor:
    def __init__(self, engine: Optional[Engine], *, budget_bytes: Optional[int] = None, cpu_limit: Optional[float] = None,
                 cores: Optional[float] = None, month: Callable[[], str] = month_now,
                 alert: Callable[..., Any] = notify, clock: Callable[[], float] = time.monotonic):
        self.engine = engine
        self.budget = budget_bytes if budget_bytes is not None else int(float(os.getenv("GAMEACCESS_EGRESS_BUDGET_GB") or BUDGET_GB) * 1024 ** 3)
        self.cpu_limit = cpu_limit if cpu_limit is not None else float(os.getenv("GAMEACCESS_CPU_LIMIT_PERCENT") or CPU_LIMIT_PERCENT)
        self.cores = cores if cores is not None else allowed_cores()
        self.month_of = month
        self.alert = alert
        self.clock = clock
        self.lock = threading.Lock()
        self.month = month()
        self.saved = self._load(self.month)  # bytes already in the database for this month
        self.pending = 0                     # counted since the last save
        self.reserved = 0                    # approved but not sent yet
        self.cpu = 0.0
        self.cpu_high_since: Optional[float] = None
        self.warned: set[str] = set()

    # ---------------------------------------------------------------- storage
    def _load(self, month: str) -> int:
        if self.engine is None:
            return 0
        with Session(self.engine) as session:
            row = session.get(ResourceUsage, month)
            return int(row.bytes_out) if row else 0

    def flush(self) -> None:
        with self.lock:
            self._roll()
            pending, self.pending = self.pending, 0
            month, total = self.month, self.saved + pending
            self.saved = total
        if self.engine is None or not pending:
            return
        try:
            with Session(self.engine) as session:
                row = session.get(ResourceUsage, month) or ResourceUsage(month=month, bytes_out=0, updated_at=datetime.now(timezone.utc))
                row.bytes_out = max(int(row.bytes_out or 0), total)
                row.updated_at = datetime.now(timezone.utc)
                session.add(row)
                session.commit()
        except Exception:  # noqa: BLE001 - a lost save is retried with the next one; never break a request for it
            logger.exception("resource_usage_save_failed")
            with self.lock:
                self.saved -= pending
                self.pending += pending

    def _roll(self) -> None:
        month = self.month_of()
        if month != self.month:
            self.month, self.saved, self.pending, self.warned = month, self._load(month), 0, set()

    # ---------------------------------------------------------------- traffic
    def used(self) -> int:
        return self.saved + self.pending

    def count_out(self, nbytes: int) -> None:
        with self.lock:
            self._roll()
            self.pending += max(int(nbytes), 0)
        self._check_budget()

    def approve(self, nbytes: int) -> bool:
        """Reserve room for `nbytes` this server is about to send; False when that would pass the stop line."""
        with self.lock:
            self._roll()
            allowed = self.used() + self.reserved + nbytes <= self.budget * STOP_SHARE
            if allowed:
                self.reserved += nbytes
        if not allowed:
            self._warn("stop", "Servidor: tráfico del mes al límite",
                       f"Se frenaron las descargas por partes: {self._gb(self.used())} de {self._gb(self.budget)} usados este mes.")
        return allowed

    def release(self, nbytes: int, sent: bool) -> None:
        with self.lock:
            self.reserved = max(self.reserved - nbytes, 0)
        if sent:
            self.count_out(nbytes)

    def _check_budget(self) -> None:
        if self.used() >= self.budget * WARN_SHARE:
            self._warn("warn", "Servidor: tráfico del mes al 80 %",
                       f"Van {self._gb(self.used())} de {self._gb(self.budget)} de tráfico saliente este mes.")

    def _warn(self, kind: str, title: str, message: str) -> None:
        key = f"{kind}:{self.month}"
        with self.lock:
            if key in self.warned:
                return
            self.warned.add(key)
        self.alert(f"traffic-{key}", title, message, priority=5 if kind == "stop" else 4, cooldown=0)

    @staticmethod
    def _gb(nbytes: int) -> str:
        return f"{nbytes / 1024 ** 3:.2f} GB"

    # ---------------------------------------------------------------- CPU
    def cpu_ok(self) -> bool:
        return self.cpu < self.cpu_limit

    def record_cpu(self, percent: float) -> None:
        self.cpu = percent
        now = self.clock()
        if percent < self.cpu_limit:
            self.cpu_high_since = None
            return
        if self.cpu_high_since is None:
            self.cpu_high_since = now
        if now - self.cpu_high_since >= CPU_ALERT_SECONDS:
            self.alert("cpu-high", "Servidor: CPU alta", f"La CPU está al {percent:.0f} % desde hace más de 5 minutos.", priority=4)

    def snapshot(self) -> dict:
        return {"month": self.month, "bytes_out": self.used(), "reserved": self.reserved, "budget_bytes": self.budget,
                "stop_at_bytes": int(self.budget * STOP_SHARE), "cpu_percent": round(self.cpu, 1),
                "cpu_limit_percent": self.cpu_limit, "cpu_cores_allowed": round(self.cores, 2)}


class TrafficCounter:
    """ASGI middleware: adds every HTTP response's size (body plus a rough header size) to the month's count."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        governor = current()
        if scope.get("type") != "http" or governor is None:
            await self.app(scope, receive, send)
            return
        total = 0

        async def counting_send(message):
            nonlocal total
            if message["type"] == "http.response.start":
                total += HEADER_BYTES
            elif message["type"] == "http.response.body":
                total += len(message.get("body") or b"")
            await send(message)

        try:
            await self.app(scope, receive, counting_send)
        finally:
            governor.count_out(total)


# ---------------------------------------------------------------- the running server's governor
_governor: Optional[Governor] = None
_stop = threading.Event()


def current() -> Optional[Governor]:
    return _governor


def _sample(governor: Governor, stop: threading.Event) -> None:
    last_cpu, last_wall, last_flush = time.process_time(), time.monotonic(), time.monotonic()
    while not stop.wait(SAMPLE_SECONDS):
        cpu, wall = time.process_time(), time.monotonic()
        governor.record_cpu((cpu - last_cpu) / max(wall - last_wall, .001) / governor.cores * 100)
        last_cpu, last_wall = cpu, wall
        if wall - last_flush >= FLUSH_SECONDS:
            last_flush = wall
            governor.flush()
    governor.flush()


def start(engine: Engine) -> Governor:
    global _governor
    if _governor is None:
        _governor = Governor(engine)
        _stop.clear()
        threading.Thread(target=_sample, args=(_governor, _stop), name="resource-governor", daemon=True).start()
        logger.info("resource_governor_started %s", _governor.snapshot())
    return _governor


def stop() -> None:
    _stop.set()
