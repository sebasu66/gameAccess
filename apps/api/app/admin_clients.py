"""One nested view of every client: key, activation events and the downloads it asked for."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlmodel import Session, func, select

from .access_keys import AccessKey
from .download_events import DownloadEvent
from .models import AccessEvent
from .telemetry import ClientPresence, ChunkTransfer, ServerSample, DOWNLOADING_WINDOW, ONLINE_WINDOW, overview
from .viking_chunk_models import VikingChunkJob

ARGENTINA = timezone(timedelta(hours=-3))
MAX_BUCKETS = 120


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _key_state(key: AccessKey, now: datetime) -> str:
    if key.revoked_at:
        return "revocada"
    expires = _utc(key.expires_at)
    if expires and expires <= now:
        return "vencida"
    return "activa" if key.activated_at else "sin usar"


def _remaining_seconds(key: AccessKey, now: datetime) -> int | None:
    """Seconds this key still gives access for; None when it has not started or never ends."""
    expires = _utc(key.expires_at)
    if key.revoked_at or expires is None:
        return None
    return max(0, int((expires - now).total_seconds()))


def _key_info(key: AccessKey, now: datetime) -> dict[str, Any]:
    return {
        "id": key.id, "tier": key.access_tier, "state": _key_state(key, now), "obtained_at": _utc(key.activated_at),
        "expires_at": _utc(key.expires_at), "revoked_at": _utc(key.revoked_at), "remaining_seconds": _remaining_seconds(key, now),
        "duration_hours": key.duration_hours, "duration_months": key.duration_months,
    }


def _download_tasks(local_session: Session, ids: list[str], since: datetime) -> dict[str, list[dict[str, Any]]]:
    """Per client, the downloads it asked for since `since`, newest first. (Local database: chunk/telemetry tables.)"""
    result: dict[str, list[dict[str, Any]]] = {i: [] for i in ids}
    if not ids:
        return result
    transfers = local_session.exec(
        select(ChunkTransfer.installation_id, ChunkTransfer.job_id, func.max(ChunkTransfer.item_name), func.min(ChunkTransfer.served_at),
               func.max(ChunkTransfer.served_at), func.count(ChunkTransfer.id), func.coalesce(func.sum(ChunkTransfer.size_bytes), 0))
        .where(ChunkTransfer.installation_id.in_(ids), ChunkTransfer.served_at >= since)
        .group_by(ChunkTransfer.installation_id, ChunkTransfer.job_id)
    ).all()
    events = local_session.exec(
        select(DownloadEvent).where(DownloadEvent.installation_id.in_(ids), DownloadEvent.created_at >= since).order_by(DownloadEvent.id)
    ).all()
    job_ids = {t[1] for t in transfers} | {e.job_id for e in events}
    jobs = {j.job_id: j for j in local_session.exec(select(VikingChunkJob).where(VikingChunkJob.job_id.in_(job_ids))).all()} if job_ids else {}
    last_event: dict[tuple[str, str], DownloadEvent] = {}
    first_event: dict[tuple[str, str], DownloadEvent] = {}
    story: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for e in events:
        last_event[(e.installation_id, e.job_id)] = e
        first_event.setdefault((e.installation_id, e.job_id), e)
        story.setdefault((e.installation_id, e.job_id), []).append(
            {"at": _utc(e.created_at), "step": e.step, "status": e.status, "message": e.message})
    # The server's own job events carry no installation for every step; a job asked by one client tells its story too.
    job_story: dict[str, list[dict[str, Any]]] = {}
    for e in local_session.exec(select(DownloadEvent).where(DownloadEvent.job_id.in_({k[1] for k in last_event} | {t[1] for t in transfers}),
                                                            DownloadEvent.created_at >= since).order_by(DownloadEvent.id)).all() if (last_event or transfers) else []:
        job_story.setdefault(e.job_id, []).append({"at": _utc(e.created_at), "step": e.step, "status": e.status, "message": e.message})

    def status_of(key, job) -> str:
        """The client's own word wins (it knows whether its download ended); otherwise the server job's state."""
        client = [e for e in story.get(key, []) if e["step"] == "client"]
        if client:
            last = client[-1]
            if last["status"] == "error":
                return "failed"
            if "terminó" in last["message"]:
                return "completo"
            if "canceló" in last["message"]:
                return "cancelado"
            if "torrent directo" in last["message"]:
                return "torrent"
            return "en curso"
        return job.status if job is not None else "desconocido"

    def events_for(key) -> list[dict[str, Any]]:
        merged = {(e["at"], e["message"]): e for e in [*job_story.get(key[1], []), *story.get(key, [])]}
        return sorted(merged.values(), key=lambda e: e["at"])[-40:]
    seen: set[tuple[str, str]] = set()
    for installation, job_id, name, first, last, count, size in transfers:
        key = (installation, job_id)
        seen.add(key)
        job = jobs.get(job_id)
        last_e = last_event.get(key)
        result[installation].append({
            "job_id": job_id, "item_name": name or (job.item_name if job else ""), "started_at": _utc(first), "last_at": _utc(last),
            "pieces": int(count or 0), "bytes": int(size or 0), "status": status_of(key, job),
            "message": last_e.message if last_e else "", "events": events_for(key),
        })
    for key, e in last_event.items():
        if key in seen:
            continue
        job = jobs.get(key[1])
        result[key[0]].append({
            "job_id": key[1], "item_name": e.item_name or (job.item_name if job else ""), "started_at": _utc(first_event[key].created_at),
            "last_at": _utc(e.created_at), "pieces": 0, "bytes": 0, "status": status_of(key, job), "message": e.message,
            "events": events_for(key),
        })
    for tasks in result.values():
        tasks.sort(key=lambda t: t["last_at"] or since, reverse=True)
    return result


def integrated_clients(session: Session, local_session: Session, hours: int = 24, limit: int = 200) -> list[dict[str, Any]]:
    """`session` is the shared Supabase database (AccessKey/AccessEvent); `local_session` is this
    instance's local database (ClientPresence/ChunkTransfer/VikingChunkJob/DownloadEvent)."""
    now = _now()
    since = now - timedelta(hours=hours)
    rows = local_session.exec(select(ClientPresence).order_by(ClientPresence.last_seen_at.desc()).limit(limit)).all()
    ids = [r.installation_id for r in rows]
    keys: dict[str, list[AccessKey]] = {}
    events: dict[str, list[AccessEvent]] = {}
    if ids:
        for key in session.exec(select(AccessKey).where(AccessKey.installation_id.in_(ids)).order_by(AccessKey.activated_at.desc())).all():
            keys.setdefault(key.installation_id or "", []).append(key)
        for ev in session.exec(
            select(AccessEvent).where(AccessEvent.installation_id.in_(ids), AccessEvent.action.like("activation-%"))
            .order_by(AccessEvent.created_at.desc()).limit(2000)
        ).all():
            bucket = events.setdefault(ev.installation_id, [])
            if len(bucket) < 15:
                bucket.append(ev)
    tasks = _download_tasks(local_session, ids, since)
    result = []
    for row in rows:
        seen = _utc(row.last_seen_at)
        mine = keys.get(row.installation_id, [])
        current = mine[0] if mine else None
        recent_tasks = tasks.get(row.installation_id, [])
        last_piece = max((t["last_at"] for t in recent_tasks if t["pieces"]), default=None)
        result.append({
            "installation_id": row.installation_id,
            "access_tier": row.access_tier or (current.access_tier if current else ""),
            "first_seen_at": _utc(row.first_seen_at),
            "last_seen_at": seen,
            "online": bool(seen and now - seen <= ONLINE_WINDOW),
            "downloading": bool(last_piece and now - last_piece <= DOWNLOADING_WINDOW),
            "key": None if current is None else {**_key_info(current, now), "keys_total": len(mine)},
            "keys": [_key_info(k, now) for k in mine],
            "activation_events": [
                {"at": _utc(e.created_at), "action": e.action, "outcome": e.outcome, "reason": e.reason} for e in events.get(row.installation_id, [])
            ],
            "tasks": recent_tasks,
            "tasks_count": len(recent_tasks),
            "bytes_in_range": sum(t["bytes"] for t in recent_tasks),
        })
    return result


def activity_summary(local_session: Session, hours: int = 24) -> dict[str, Any]:
    """Bottom block: concurrency, downloads today/this week, a chart and load numbers. (Local database.)"""
    now = _now()
    base = overview(local_session)
    midnight = now.astimezone(ARGENTINA).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)

    def started(since: datetime) -> int:
        return int(local_session.exec(
            select(func.count(func.distinct(ChunkTransfer.job_id))).where(ChunkTransfer.kind == "start", ChunkTransfer.served_at >= since)
        ).one() or 0)

    def asked_by(since: datetime) -> int:
        return int(local_session.exec(
            select(func.count(func.distinct(ChunkTransfer.installation_id))).where(ChunkTransfer.kind == "start", ChunkTransfer.served_at >= since)
        ).one() or 0)

    since = now - timedelta(hours=hours)
    samples = local_session.exec(select(ServerSample).where(ServerSample.sampled_at >= since).order_by(ServerSample.sampled_at)).all()
    step = max(1, -(-len(samples) // MAX_BUCKETS))
    series = []
    for i in range(0, len(samples), step):
        chunk = samples[i:i + step]
        series.append({
            "at": _utc(chunk[0].sampled_at),
            "online": max(s.clients_online for s in chunk),
            "downloading": max(s.clients_downloading for s in chunk),
            "jobs": max(s.jobs_active for s in chunk),
            "mbps": round(max(s.bytes_served_last_minute for s in chunk) * 8 / 60 / 1_000_000, 1),
        })
    return {
        "now": now, "range_hours": hours,
        "clients_online": base["clients_online"], "clients_downloading": base["clients_downloading"], "clients_total": base["clients_total"],
        "peaks_7d": base["peaks_7d"], "limits": base["limits"], "jobs": base["jobs"],
        "downloads_today": started(midnight), "downloads_7d": started(now - timedelta(days=7)),
        "clients_downloading_today": asked_by(midnight),
        "bytes_served_24h": base["bytes_served_24h"], "bytes_served_7d": base["bytes_served_7d"],
        "bytes_stored_in_viking": base["bytes_stored_in_viking"], "work_dir_bytes": base["work_dir_bytes"],
        "series": series, "daily": base["daily"],
    }
