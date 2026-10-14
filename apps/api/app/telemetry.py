"""Who is connected, what each client downloads, and how the load evolves over time.

Everything lives in the shared database, so several server instances (local, Render) agree.
Writes are small and never allowed to break the request that triggers them.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import BigInteger, Column, UniqueConstraint, func
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlmodel import Field as SQLField, Session, SQLModel, select

from .viking_chunk_models import VikingChunkJob, VikingChunkPiece

logger = logging.getLogger("gameaccess.telemetry")

ONLINE_WINDOW = timedelta(minutes=3)       # a client counts as connected if it checked in this recently
DOWNLOADING_WINDOW = timedelta(minutes=2)  # ...and as downloading if it asked for a piece this recently
HEARTBEAT_WRITE_EVERY = timedelta(seconds=20)
SAMPLE_EVERY_SECONDS = 60
SAMPLE_KEEP_DAYS = 60
TRANSFER_KEEP_DAYS = 180


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class ClientPresence(SQLModel, table=True):
    """One row per installation: when it was first and last seen."""

    __tablename__ = "client_presence"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    installation_id: str = SQLField(index=True, unique=True, max_length=36)
    access_tier: str = SQLField(default="", max_length=12)
    first_seen_at: datetime = SQLField(index=True)
    last_seen_at: datetime = SQLField(index=True)
    heartbeats: int = 0


class ChunkTransfer(SQLModel, table=True):
    """A piece handed to a client ("piece") or a download a client asked for ("start")."""

    __tablename__ = "chunk_transfer"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    installation_id: str = SQLField(index=True, max_length=36)
    job_id: str = SQLField(index=True, max_length=40)
    kind: str = SQLField(default="piece", max_length=8)
    piece_index: int = -1
    size_bytes: int = SQLField(default=0, sa_column=Column(BigInteger))
    item_name: str = SQLField(default="", max_length=300)
    served_at: datetime = SQLField(index=True)


class ServerSample(SQLModel, table=True):
    """One reading per minute, kept to see peaks and decide limits."""

    __tablename__ = "server_sample"
    __table_args__ = (UniqueConstraint("sampled_at", name="uq_server_sample_minute"),)

    id: Optional[int] = SQLField(default=None, primary_key=True)
    sampled_at: datetime = SQLField(index=True)
    clients_online: int = 0
    clients_downloading: int = 0
    jobs_active: int = 0
    bytes_served_last_minute: int = SQLField(default=0, sa_column=Column(BigInteger))


# ---------------------------------------------------------------- recording

def record_heartbeat(session: Session, installation_id: str, access_tier: str = "") -> None:
    """Mark a client as seen. Skips the write when the last one is very recent."""
    try:
        if not installation_id:
            return
        now = _now()
        row = session.exec(select(ClientPresence).where(ClientPresence.installation_id == installation_id)).first()
        if row is None:
            session.add(ClientPresence(
                installation_id=installation_id, access_tier=access_tier[:12], first_seen_at=now, last_seen_at=now, heartbeats=1,
            ))
            session.commit()
            return
        last = _utc(row.last_seen_at)
        if last and now - last < HEARTBEAT_WRITE_EVERY:
            return
        row.last_seen_at, row.heartbeats = now, (row.heartbeats or 0) + 1
        if access_tier:
            row.access_tier = access_tier[:12]
        session.add(row)
        session.commit()
    except Exception:  # noqa: BLE001 - telemetry must never break a request
        session.rollback()
        logger.warning("telemetry heartbeat failed", exc_info=True)


def record_transfer(session: Session, *, installation_id: str, job_id: str, kind: str, piece_index: int = -1,
                    size_bytes: int = 0, item_name: str = "") -> None:
    try:
        session.add(ChunkTransfer(
            installation_id=installation_id, job_id=job_id, kind=kind[:8], piece_index=piece_index,
            size_bytes=int(size_bytes), item_name=item_name[:300], served_at=_now(),
        ))
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.warning("telemetry transfer failed", exc_info=True)


def take_sample(engine: Engine) -> bool:
    """Store one per-minute reading. Returns False when another instance already stored this minute."""
    now = _now().replace(second=0, microsecond=0)
    with Session(engine) as session:
        online = _count_online(session, now)
        downloading = _count_downloading(session, now)
        active = session.exec(select(func.count(VikingChunkJob.id)).where(VikingChunkJob.status.in_(("preparing", "running")))).one()
        served = session.exec(
            select(func.coalesce(func.sum(ChunkTransfer.size_bytes), 0))
            .where(ChunkTransfer.kind == "piece", ChunkTransfer.served_at >= now - timedelta(minutes=1), ChunkTransfer.served_at < now)
        ).one()
        session.add(ServerSample(
            sampled_at=now, clients_online=int(online), clients_downloading=int(downloading),
            jobs_active=int(active or 0), bytes_served_last_minute=int(served or 0),
        ))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            return False
    return True


def prune(engine: Engine) -> None:
    with Session(engine) as session:
        for model, column, days in ((ServerSample, ServerSample.sampled_at, SAMPLE_KEEP_DAYS), (ChunkTransfer, ChunkTransfer.served_at, TRANSFER_KEEP_DAYS)):
            for row in session.exec(select(model).where(column < _now() - timedelta(days=days)).limit(5000)).all():
                session.delete(row)
        session.commit()


_sampler: threading.Thread | None = None
_stop = threading.Event()


def start_sampler(engine: Engine) -> None:
    """Background reading every minute (a thread, like the other maintenance workers)."""
    global _sampler
    if _sampler is not None and _sampler.is_alive():
        return
    _stop.clear()

    def loop() -> None:
        ticks = 0
        while not _stop.wait(SAMPLE_EVERY_SECONDS):
            try:
                take_sample(engine)
                ticks += 1
                if ticks % 360 == 0:
                    prune(engine)
            except Exception:  # noqa: BLE001
                logger.warning("telemetry sample failed", exc_info=True)

    _sampler = threading.Thread(target=loop, name="gameaccess-telemetry", daemon=True)
    _sampler.start()


def stop_sampler() -> None:
    _stop.set()


# ---------------------------------------------------------------- reading

def _count_online(session: Session, now: datetime) -> int:
    return int(session.exec(select(func.count(ClientPresence.id)).where(ClientPresence.last_seen_at >= now - ONLINE_WINDOW)).one() or 0)


def _count_downloading(session: Session, now: datetime) -> int:
    return int(session.exec(
        select(func.count(func.distinct(ChunkTransfer.installation_id))).where(ChunkTransfer.served_at >= now - DOWNLOADING_WINDOW)
    ).one() or 0)


def _dir_size(path: Path) -> int:
    total = 0
    try:
        for item in path.glob("*"):
            if item.is_file():
                total += item.stat().st_size
    except OSError:
        pass
    return total


def overview(session: Session, work_dir: Path | None = None) -> dict[str, Any]:
    """Numbers for the top of the dashboard and the capacity planning block."""
    now = _now()
    day = now - timedelta(days=1)
    week = now - timedelta(days=7)

    def served(since: datetime) -> int:
        return int(session.exec(
            select(func.coalesce(func.sum(ChunkTransfer.size_bytes), 0)).where(ChunkTransfer.kind == "piece", ChunkTransfer.served_at >= since)
        ).one() or 0)

    job_counts = dict(session.exec(select(VikingChunkJob.status, func.count(VikingChunkJob.id)).group_by(VikingChunkJob.status)).all())
    stored = int(session.exec(
        select(func.coalesce(func.sum(VikingChunkPiece.size_bytes), 0)).where(VikingChunkPiece.status == "ready")
    ).one() or 0)
    clients_total = int(session.exec(select(func.count(ClientPresence.id))).one() or 0)
    new_week = int(session.exec(select(func.count(ClientPresence.id)).where(ClientPresence.first_seen_at >= week)).one() or 0)

    samples = session.exec(select(ServerSample).where(ServerSample.sampled_at >= week).order_by(ServerSample.sampled_at)).all()
    peak_online = max((s.clients_online for s in samples), default=0)
    peak_downloading = max((s.clients_downloading for s in samples), default=0)
    peak_mbps = max((s.bytes_served_last_minute * 8 / 60 / 1_000_000 for s in samples), default=0.0)

    daily: dict[str, dict[str, Any]] = {}
    for s in samples:
        key = _utc(s.sampled_at).strftime("%Y-%m-%d")
        d = daily.setdefault(key, {"day": key, "bytes_served": 0, "peak_online": 0, "peak_downloading": 0})
        d["bytes_served"] += int(s.bytes_served_last_minute or 0)
        d["peak_online"] = max(d["peak_online"], s.clients_online)
        d["peak_downloading"] = max(d["peak_downloading"], s.clients_downloading)

    hourly = [
        {"at": _utc(s.sampled_at), "online": s.clients_online, "downloading": s.clients_downloading,
         "mbps": round(s.bytes_served_last_minute * 8 / 60 / 1_000_000, 1)}
        for s in samples if _utc(s.sampled_at) >= now - timedelta(hours=6)
    ]
    return {
        "now": now,
        "clients_online": _count_online(session, now),
        "clients_downloading": _count_downloading(session, now),
        "clients_total": clients_total,
        "clients_new_7d": new_week,
        "jobs": {k: int(v) for k, v in job_counts.items()},
        "bytes_served_24h": served(day),
        "bytes_served_7d": served(week),
        "bytes_stored_in_viking": stored,
        "work_dir_bytes": _dir_size(work_dir) if work_dir else 0,
        "peaks_7d": {"online": peak_online, "downloading": peak_downloading, "mbps": round(peak_mbps, 1)},
        "daily": sorted(daily.values(), key=lambda d: d["day"]),
        "last_6h": hourly[-360:],
        "limits": {
            "max_jobs": int(os.getenv("GAMEACCESS_CHUNK_MAX_JOBS", "2")),
            "uploads_per_job": int(os.getenv("GAMEACCESS_CHUNK_UPLOADS", "3")),
        },
    }


def clients(session: Session, limit: int = 200) -> list[dict[str, Any]]:
    """Every known client with what it downloaded, most recently seen first."""
    now = _now()
    rows = session.exec(select(ClientPresence).order_by(ClientPresence.last_seen_at.desc()).limit(limit)).all()
    totals = {
        installation: (int(count or 0), int(size or 0), last)
        for installation, count, size, last in session.exec(
            select(ChunkTransfer.installation_id, func.count(ChunkTransfer.id), func.coalesce(func.sum(ChunkTransfer.size_bytes), 0), func.max(ChunkTransfer.served_at))
            .where(ChunkTransfer.kind == "piece").group_by(ChunkTransfer.installation_id)
        ).all()
    }
    day = now - timedelta(days=1)
    last_day = {
        installation: int(size or 0)
        for installation, size in session.exec(
            select(ChunkTransfer.installation_id, func.coalesce(func.sum(ChunkTransfer.size_bytes), 0))
            .where(ChunkTransfer.kind == "piece", ChunkTransfer.served_at >= day).group_by(ChunkTransfer.installation_id)
        ).all()
    }
    result = []
    for row in rows:
        pieces, size, last_piece = totals.get(row.installation_id, (0, 0, None))
        seen = _utc(row.last_seen_at)
        recent_piece = _utc(last_piece)
        result.append({
            "installation_id": row.installation_id,
            "access_tier": row.access_tier,
            "first_seen_at": _utc(row.first_seen_at),
            "last_seen_at": seen,
            "online": bool(seen and now - seen <= ONLINE_WINDOW),
            "downloading": bool(recent_piece and now - recent_piece <= DOWNLOADING_WINDOW),
            "pieces_served": pieces,
            "bytes_served": size,
            "bytes_served_24h": last_day.get(row.installation_id, 0),
            "last_download_at": recent_piece,
        })
    return result


def client_history(session: Session, installation_id: str, limit: int = 100) -> dict[str, Any]:
    """The detail of one client: days it was active, games it asked for and its latest pieces."""
    presence = session.exec(select(ClientPresence).where(ClientPresence.installation_id == installation_id)).first()
    transfers = session.exec(
        select(ChunkTransfer).where(ChunkTransfer.installation_id == installation_id).order_by(ChunkTransfer.served_at.desc()).limit(2000)
    ).all()
    per_day: dict[str, int] = {}
    per_game: dict[str, dict[str, Any]] = {}
    for t in transfers:
        if t.kind == "piece":
            per_day[_utc(t.served_at).strftime("%Y-%m-%d")] = per_day.get(_utc(t.served_at).strftime("%Y-%m-%d"), 0) + int(t.size_bytes or 0)
        game = per_game.setdefault(t.job_id, {"job_id": t.job_id, "item_name": t.item_name, "requested": 0, "pieces": 0, "bytes": 0, "last_at": _utc(t.served_at)})
        game["item_name"] = game["item_name"] or t.item_name
        if t.kind == "start":
            game["requested"] += 1
        else:
            game["pieces"] += 1
            game["bytes"] += int(t.size_bytes or 0)
    return {
        "installation_id": installation_id,
        "known": presence is not None,
        "access_tier": presence.access_tier if presence else "",
        "first_seen_at": _utc(presence.first_seen_at) if presence else None,
        "last_seen_at": _utc(presence.last_seen_at) if presence else None,
        "per_day": [{"day": k, "bytes": v} for k, v in sorted(per_day.items())],
        "games": sorted(per_game.values(), key=lambda g: g["last_at"], reverse=True),
        "recent": [
            {"at": _utc(t.served_at), "kind": t.kind, "item_name": t.item_name, "piece_index": t.piece_index, "size_bytes": int(t.size_bytes or 0)}
            for t in transfers[:limit]
        ],
    }
