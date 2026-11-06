"""The story of every download, step by step ("asked TorBox", "uploading to ViKiNG", the error...).

What the administrator reads in the running-tasks page. Writing an event never breaks the work it describes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.engine import Engine
from sqlmodel import Field as SQLField, Session, SQLModel, select

from .viking_chunk_models import VikingChunkJob

logger = logging.getLogger("gameaccess.download_events")


class DownloadEvent(SQLModel, table=True):
    __tablename__ = "download_event"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    created_at: datetime = SQLField(index=True)
    job_id: str = SQLField(index=True, max_length=40)
    installation_id: str = SQLField(default="", index=True, max_length=36)
    item_name: str = SQLField(default="", max_length=300)
    # request | cache | resume | torbox | viking | ready | error
    step: str = SQLField(default="", max_length=24)
    # info | ok | error
    status: str = SQLField(default="info", index=True, max_length=8)
    message: str = SQLField(default="", max_length=500)


def log_event(engine: Engine, job_id: str, step: str, message: str, *, status: str = "info",
              installation_id: str = "", item_name: str = "") -> None:
    try:
        with Session(engine) as session:
            if not item_name:
                try:
                    job = session.exec(select(VikingChunkJob).where(VikingChunkJob.job_id == job_id)).first()
                    item_name = job.item_name if job else ""
                except Exception:  # noqa: BLE001
                    session.rollback()
            session.add(DownloadEvent(
                created_at=datetime.now(timezone.utc), job_id=job_id, installation_id=installation_id[:36],
                item_name=item_name[:300], step=step[:24], status=status[:8], message=message[:500],
            ))
            session.commit()
    except Exception:  # noqa: BLE001
        logger.warning("download event failed", exc_info=True)


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def event_dict(row: DownloadEvent) -> dict[str, Any]:
    return {
        "at": _utc(row.created_at), "job_id": row.job_id, "installation_id": row.installation_id, "item_name": row.item_name,
        "step": row.step, "status": row.status, "message": row.message,
    }


def events_for_jobs(session: Session, job_ids: list[str], per_job: int = 30) -> dict[str, list[dict[str, Any]]]:
    """Oldest first, at most `per_job` newest events of each job."""
    result: dict[str, list[dict[str, Any]]] = {job_id: [] for job_id in job_ids}
    if not job_ids:
        return result
    rows = session.exec(select(DownloadEvent).where(DownloadEvent.job_id.in_(job_ids)).order_by(DownloadEvent.id.desc())).all()
    for row in rows:
        bucket = result[row.job_id]
        if len(bucket) < per_job:
            bucket.append(event_dict(row))
    for bucket in result.values():
        bucket.reverse()
    return result


def requesting_client(events: list[dict[str, Any]]) -> str:
    for event in events:
        if event["installation_id"]:
            return event["installation_id"]
    return ""


def recent_errors(session: Session, since: datetime, limit: int = 200) -> list[dict[str, Any]]:
    rows = session.exec(
        select(DownloadEvent).where(DownloadEvent.status == "error", DownloadEvent.created_at >= since)
        .order_by(DownloadEvent.id.desc()).limit(limit)
    ).all()
    return [event_dict(row) for row in rows]
