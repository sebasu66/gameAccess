"""Client endpoint for resolving a source through TorBox -> ViKiNG, plus admin usage reporting."""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, func, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from .access_keys import AccessKey, canonical_installation_id
from .access_overrides import CourtesySession, courtesy_access_tier
from .access_service import _activation_for_request, _admin_activation_access
from .admin_security import _admin_browser_access
from .api_dependencies import get_session
from .local_database import get_local_session
from .models import VikingDownloadRequest, VikingSourceCache
from .request_diagnostics import detail
from .viking_cache_service import (
    ProviderFailure,
    SourceIdentity,
    create_provider,
    normalize_source_url,
)

router = APIRouter(tags=["Viking cache"])
logger = logging.getLogger("gameaccess.viking_cache")
_CACHE_PROCESSING_STALE_AFTER = timedelta(minutes=90)


def ensure_viking_schema(engine) -> None:
    """Widen the size columns of databases created before sizes could exceed 2 GB."""
    inspector = inspect(engine)
    if inspector.has_table("viking_chunk_job"):
        have = {c["name"] for c in inspector.get_columns("viking_chunk_job")}
        for name, size in (("owner", 80), ("detail", 600)):
            if name not in have:
                with engine.begin() as connection:
                    connection.execute(text(f"ALTER TABLE viking_chunk_job ADD COLUMN {name} VARCHAR({size}) NOT NULL DEFAULT ''"))
                logger.warning("viking_schema added viking_chunk_job.%s", name)
    if engine.dialect.name != "postgresql":
        return
    for table in ("viking_download_request", "viking_source_cache"):
        if not inspector.has_table(table):
            continue
        for column in inspector.get_columns(table):
            if column["name"] == "file_size_bytes" and "BIGINT" not in str(column["type"]).upper():
                with engine.begin() as connection:
                    connection.execute(text(f"ALTER TABLE {table} ALTER COLUMN file_size_bytes TYPE BIGINT"))
                logger.warning("viking_schema widened %s.file_size_bytes to BIGINT", table)


def recover_interrupted_viking_requests(engine) -> int:
    """Close requests a restart left as "processing".

    A request only lives inside the process that handles it, so after a restart nothing is
    still working on the ones the database calls "processing". Left alone they stay in the
    admin table forever and the cache entry rejects new requests for the same source until
    it goes stale. Run once at startup; returns how many requests were closed."""
    now = _now()
    with Session(engine) as session:
        rows = session.exec(select(VikingDownloadRequest).where(VikingDownloadRequest.status == "processing")).all()
        for row in rows:
            row.status = "failed"
            row.error_code = "server_restarted"
            row.completed_at = now
            session.add(row)
        caches = session.exec(select(VikingSourceCache).where(VikingSourceCache.status == "processing")).all()
        for cache in caches:
            cache.status = "failed"
            cache.last_error_code = "server_restarted"
            cache.updated_at = now
            session.add(cache)
        session.commit()
        if rows or caches:
            logger.warning("viking_recovery closed_requests=%s closed_cache_entries=%s", len(rows), len(caches))
        return len(rows)


class VikingDownloadResolveRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=8192)
    item_name: str = Field(default="", max_length=300)
    file_name: str = Field(default="", max_length=300)
    app_id: int | None = Field(default=None, ge=1)
    client_build: str = Field(default="", max_length=120)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_text(value: str, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _cache_row(session: Session, fingerprint: str, *, lock: bool = False) -> VikingSourceCache | None:
    statement = select(VikingSourceCache).where(
        VikingSourceCache.source_fingerprint == fingerprint
    )
    if lock:
        statement = statement.with_for_update()
    return session.exec(statement).first()


def _finish_request(
    session: Session,
    row: VikingDownloadRequest,
    *,
    status: str,
    started: float,
    error_code: str = "",
    cache_hit: bool = False,
    result_name: str = "",
    result_hash: str = "",
    result_url: str = "",
    size_bytes: int | None = None,
    torbox_item_id: int | None = None,
) -> None:
    row.status = status
    row.cache_hit = cache_hit
    row.completed_at = _now()
    row.duration_ms = max(0, int((time.monotonic() - started) * 1000))
    row.error_code = error_code[:80]
    row.result_name = _safe_text(result_name, 300)
    row.result_hash = result_hash[:120]
    row.result_url = result_url
    row.file_size_bytes = size_bytes
    row.torbox_item_id = torbox_item_id
    session.add(row)
    session.commit()


def _claim_cache(
    session: Session,
    identity: SourceIdentity,
    *,
    item_name: str,
) -> VikingSourceCache | None:
    """Claim the fingerprint for one worker; return None if another request owns it."""
    cache = _cache_row(session, identity.fingerprint, lock=True)
    now = _now()

    if cache is None:
        cache = VikingSourceCache(
            source_fingerprint=identity.fingerprint,
            source_kind=identity.kind,
            source_host=identity.host,
            item_name=item_name,
            status="processing",
            created_at=now,
            updated_at=now,
        )
        session.add(cache)
        try:
            session.commit()
            session.refresh(cache)
            return cache
        except IntegrityError:
            session.rollback()
            cache = _cache_row(session, identity.fingerprint, lock=True)
            if cache is None:
                raise

    if cache.status == "processing" and now - cache.updated_at < _CACHE_PROCESSING_STALE_AFTER:
        return None

    cache.source_kind = identity.kind
    cache.source_host = identity.host
    cache.item_name = item_name or cache.item_name
    cache.status = "processing"
    cache.viking_hash = None
    cache.viking_url = None
    cache.viking_name = ""
    cache.file_size_bytes = None
    cache.last_error_code = ""
    cache.updated_at = now
    session.add(cache)
    session.commit()
    session.refresh(cache)
    return cache


def _reject_already_processing(
    session: Session,
    row: VikingDownloadRequest,
    *,
    started: float,
) -> None:
    _finish_request(
        session, row, status="rejected", started=started,
        error_code="source_processing",
    )
    logger.info(
        "request=%s client=%s stage=deferred reason=source_processing fingerprint=%s",
        row.request_id, row.installation_id, row.source_fingerprint[:12],
    )
    raise HTTPException(
        status_code=409,
        detail="Esta fuente ya se está procesando. Reintenta la solicitud en unos segundos.",
        headers={"Retry-After": "15"},
    )


@router.post("/downloads/viking-cache")
async def resolve_viking_download(
    req: VikingDownloadResolveRequest,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
) -> dict:
    """Return a ViKiNG file URL, reusing it only after verifying it still exists."""
    response.headers["Cache-Control"] = "no-store"
    access = _activation_for_request(request, session)
    if access is None:
        raise HTTPException(401, "Se requiere una activación vigente de GameAccess.")

    try:
        installation_id = canonical_installation_id(
            request.headers.get("X-GameAccess-Installation", "")
        )
    except ValueError as exc:
        raise HTTPException(401, "La instalación de GameAccess no es válida.") from exc

    tier = courtesy_access_tier(access) if isinstance(access, CourtesySession) else access.access_tier
    if tier != "plus":
        raise HTTPException(403, "La aceleración TorBox → ViKiNG requiere el plan PLUS.")

    try:
        identity = normalize_source_url(req.source_url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    started = time.monotonic()
    request_id = uuid4().hex
    item_name = _safe_text(req.item_name, 300)
    file_name = _safe_text(req.file_name, 300)
    row = VikingDownloadRequest(
        request_id=request_id,
        installation_id=installation_id,
        app_id=req.app_id,
        client_build=_safe_text(req.client_build, 120),
        source_fingerprint=identity.fingerprint,
        source_kind=identity.kind,
        source_host=identity.host,
        item_name=item_name,
        requested_at=_now(),
        status="processing",
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    provider = create_provider()
    detail(
        "Viking resolve accepted request=%s client=%s app_id=%s kind=%s host=%s fingerprint=%s",
        request_id, installation_id, req.app_id, identity.kind, identity.host, identity.fingerprint[:12],
    )
    logger.info(
        "request=%s client=%s stage=accepted app_id=%s kind=%s host=%s item=%s fingerprint=%s",
        request_id, installation_id, req.app_id, identity.kind, identity.host,
        item_name or "unknown", identity.fingerprint[:12],
    )

    cache = _cache_row(session, identity.fingerprint)
    if cache and cache.status == "ready" and cache.viking_hash:
        try:
            exists = await provider.check_viking_file(cache.viking_hash)
        except ProviderFailure as exc:
            _finish_request(
                session, row, status="failed", started=started, error_code=exc.code,
            )
            logger.error(
                "request=%s client=%s stage=viking_check_failed code=%s fingerprint=%s",
                request_id, installation_id, exc.code, identity.fingerprint[:12],
            )
            raise HTTPException(exc.status_code, exc.public_message) from exc
        if exists:
            cache.last_checked_at = _now()
            session.add(cache)
            session.commit()
            try:
                direct_url = await provider.resolve_viking_direct_link(cache.viking_url or cache.viking_hash)
            except ProviderFailure as exc:
                _finish_request(
                    session, row, status="failed", started=started, error_code=exc.code,
                )
                logger.error(
                    "request=%s client=%s stage=viking_direct_resolve_failed code=%s fingerprint=%s",
                    request_id, installation_id, exc.code, identity.fingerprint[:12],
                )
                raise HTTPException(exc.status_code, exc.public_message) from exc

            _finish_request(
                session, row, status="completed", started=started, cache_hit=True,
                result_name=cache.viking_name, result_hash=cache.viking_hash,
                result_url=direct_url,
                size_bytes=cache.file_size_bytes,
            )
            logger.info(
                "request=%s client=%s stage=cache_hit file_hash=%s size_bytes=%s duration_ms=%s",
                request_id, installation_id, cache.viking_hash, cache.file_size_bytes or 0,
                row.duration_ms or 0,
            )
            return {
                "ok": True,
                "request_id": request_id,
                "url": direct_url,
                "name": cache.viking_name,
                "size_bytes": cache.file_size_bytes,
                "cache_hit": True,
                "mode": "cache",
            }
        logger.info(
            "request=%s client=%s stage=cache_stale file_hash=%s fingerprint=%s",
            request_id, installation_id, cache.viking_hash, identity.fingerprint[:12],
        )

    decision = await provider.decide_delivery(source_url=req.source_url, source_kind=identity.kind)
    logger.info(
        "request=%s client=%s stage=delivery_decision use_direct=%s reason=%s speed_bps=%s",
        request_id, installation_id, decision.use_direct, decision.reason, decision.speed_bps,
    )
    if decision.use_direct:
        # The original link goes back to the client. It is never stored.
        _finish_request(
            session, row, status="completed", started=started, cache_hit=False, result_name=item_name,
        )
        return {
            "ok": True,
            "request_id": request_id,
            "url": req.source_url,
            "name": item_name,
            "size_bytes": None,
            "cache_hit": False,
            "mode": "direct",
            "speed_bps": decision.speed_bps,
        }

    try:
        cache = _claim_cache(session, identity, item_name=item_name)
    except Exception as exc:
        _finish_request(
            session, row, status="failed", started=started, error_code="cache_claim_failed",
        )
        logger.error(
            "request=%s client=%s stage=cache_claim_failed error_type=%s",
            request_id, installation_id, type(exc).__name__,
        )
        raise HTTPException(503, "No se pudo reservar el procesamiento de esta fuente.") from exc
    if cache is None:
        _reject_already_processing(session, row, started=started)

    try:
        result = await provider.process_source(
            source_url=req.source_url,
            source_kind=identity.kind,
            source_host=identity.host,
            item_name=item_name,
            file_name=file_name,
            request_id=request_id,
            installation_id=installation_id,
            fingerprint=identity.fingerprint,
        )
    except ProviderFailure as exc:
        cache.status = "failed"
        cache.last_error_code = exc.code
        cache.updated_at = _now()
        session.add(cache)
        _finish_request(
            session, row, status="failed", started=started, error_code=exc.code,
        )
        logger.error(
            "request=%s client=%s stage=failed code=%s kind=%s host=%s fingerprint=%s",
            request_id, installation_id, exc.code, identity.kind, identity.host,
            identity.fingerprint[:12],
        )
        raise HTTPException(exc.status_code, exc.public_message) from exc
    except Exception as exc:
        cache.status = "failed"
        cache.last_error_code = "unexpected_error"
        cache.updated_at = _now()
        session.add(cache)
        _finish_request(
            session, row, status="failed", started=started, error_code="unexpected_error",
        )
        detail(
            "Viking resolve unexpected failure request=%s error_type=%s",
            request_id, type(exc).__name__,
        )
        logger.error(
            "request=%s client=%s stage=failed code=unexpected_error error_type=%s",
            request_id, installation_id, type(exc).__name__,
        )
        raise HTTPException(502, "No se pudo completar el procesamiento TorBox → ViKiNG.") from exc

    cache.status = "ready"
    cache.viking_hash = result.file_hash
    cache.viking_url = result.url
    cache.viking_name = result.name
    cache.file_size_bytes = result.size_bytes
    cache.last_checked_at = _now()
    cache.last_error_code = ""
    cache.updated_at = _now()
    session.add(cache)
    session.commit()
    try:
        direct_url = await provider.resolve_viking_direct_link(result.url or result.file_hash)
    except ProviderFailure as exc:
        _finish_request(
            session, row, status="failed", started=started, error_code=exc.code,
        )
        logger.error(
            "request=%s client=%s stage=viking_direct_resolve_failed code=%s fingerprint=%s",
            request_id, installation_id, exc.code, identity.fingerprint[:12],
        )
        raise HTTPException(exc.status_code, exc.public_message) from exc

    _finish_request(
        session, row, status="completed", started=started, cache_hit=False,
        result_name=result.name, result_hash=result.file_hash, result_url=direct_url,
        size_bytes=result.size_bytes, torbox_item_id=result.torbox_item_id,
    )
    logger.info(
        "request=%s client=%s stage=completed cache_hit=false file_hash=%s size_bytes=%s duration_ms=%s",
        request_id, installation_id, result.file_hash, result.size_bytes, row.duration_ms or 0,
    )
    return {
        "ok": True,
        "request_id": request_id,
        "url": direct_url,
        "name": result.name,
        "size_bytes": result.size_bytes,
        "cache_hit": False,
        "mode": "processed",
    }


@router.get("/admin/viking-download-usage")
def get_viking_download_usage(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    installation_id: str | None = Query(default=None, max_length=36),
    session: Session = Depends(get_session),
) -> dict:
    """Admin-only per-installation counts and recent file-resolution records."""
    _admin_activation_access(request)
    summary_query = select(
        VikingDownloadRequest.installation_id,
        func.count(VikingDownloadRequest.id),
        func.sum(case((VikingDownloadRequest.status == "completed", 1), else_=0)),
        func.sum(case((VikingDownloadRequest.status == "failed", 1), else_=0)),
        func.sum(case((VikingDownloadRequest.cache_hit.is_(True), 1), else_=0)),
        func.sum(case(
            (VikingDownloadRequest.status == "completed", VikingDownloadRequest.file_size_bytes),
            else_=0,
        )),
    ).group_by(VikingDownloadRequest.installation_id)
    recent_query = select(VikingDownloadRequest).order_by(VikingDownloadRequest.id.desc()).limit(limit)
    if installation_id:
        summary_query = summary_query.where(VikingDownloadRequest.installation_id == installation_id)
        recent_query = recent_query.where(VikingDownloadRequest.installation_id == installation_id)

    summaries = session.exec(summary_query.order_by(func.count(VikingDownloadRequest.id).desc())).all()
    recent = session.exec(recent_query).all()
    return {
        "summary_by_client": [
            {
                "installation_id": client_id,
                "requests": int(total or 0),
                "completed": int(completed or 0),
                "failed": int(failed or 0),
                "cache_hits": int(cache_hits or 0),
                "resolved_size_bytes": int(resolved_bytes or 0),
            }
            for client_id, total, completed, failed, cache_hits, resolved_bytes in summaries
        ],
        "requests": [
            {
                "request_id": row.request_id,
                "installation_id": row.installation_id,
                "app_id": row.app_id,
                "client_build": row.client_build,
                "requested_at": row.requested_at,
                "completed_at": row.completed_at,
                "duration_ms": row.duration_ms,
                "item_name": row.item_name,
                "source_kind": row.source_kind,
                "source_host": row.source_host,
                "source_fingerprint": row.source_fingerprint,
                "status": row.status,
                "cache_hit": row.cache_hit,
                "result_name": row.result_name,
                "result_hash": row.result_hash,
                "result_url": row.result_url,
                "file_size_bytes": row.file_size_bytes,
                "torbox_item_id": row.torbox_item_id,
                "error_code": row.error_code,
            }
            for row in recent
        ],
        "note": "resolved_size_bytes mide el tamaño de enlaces resueltos, no confirma que el cliente haya terminado la descarga.",
    }


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@router.get("/admin/viking-running-tasks")
def get_viking_running_tasks(
    request: Request, session: Session = Depends(get_session), local_session: Session = Depends(get_local_session),
) -> dict:
    """Admin-only list of links the server is processing right now (TorBox -> ViKiNG)."""
    _admin_activation_access(request)
    now = _now()
    running = session.exec(
        select(VikingDownloadRequest)
        .where(VikingDownloadRequest.status == "processing")
        .order_by(VikingDownloadRequest.requested_at.asc())
    ).all()
    since = now - timedelta(hours=24)
    last_day = session.exec(
        select(VikingDownloadRequest.status, func.count(VikingDownloadRequest.id))
        .where(VikingDownloadRequest.requested_at >= since)
        .group_by(VikingDownloadRequest.status)
    ).all()
    counts = {status: int(total or 0) for status, total in last_day}
    failures = []
    for row in session.exec(
        select(VikingDownloadRequest)
        .where(VikingDownloadRequest.requested_at >= since, VikingDownloadRequest.status.in_(("failed", "rejected")))
        .order_by(VikingDownloadRequest.requested_at.desc())
        .limit(100)
    ).all():
        failures.append({
            "at": _as_utc(row.completed_at) or _as_utc(row.requested_at), "item_name": row.item_name, "source_kind": row.source_kind,
            "source_host": row.source_host, "installation_id": row.installation_id, "status": row.status,
            "error_code": row.error_code, "flow": "enlace",
        })
    tasks = []
    for row in running:
        started = _as_utc(row.requested_at) or now
        elapsed = max(0, int((now - started).total_seconds()))
        tasks.append({
            "request_id": row.request_id,
            "installation_id": row.installation_id,
            "app_id": row.app_id,
            "item_name": row.item_name,
            "source_kind": row.source_kind,
            "source_host": row.source_host,
            "requested_at": started,
            "elapsed_seconds": elapsed,
            "possibly_stuck": elapsed > int(_CACHE_PROCESSING_STALE_AFTER.total_seconds()),
        })
    from .viking_chunk_models import VikingChunkJob
    from .download_events import events_for_jobs, recent_errors, requesting_client
    live_jobs = local_session.exec(
        select(VikingChunkJob).where(VikingChunkJob.status.in_(("preparing", "running"))).order_by(VikingChunkJob.created_at.asc())
    ).all()
    # Same mini log also for jobs that just finished, so a quick one can still be read.
    recent_jobs = local_session.exec(
        select(VikingChunkJob).where(VikingChunkJob.status.in_(("ready", "failed")), VikingChunkJob.updated_at >= now - timedelta(hours=6))
        .order_by(VikingChunkJob.updated_at.desc()).limit(30)
    ).all()
    log = events_for_jobs(local_session, [j.job_id for j in live_jobs] + [j.job_id for j in recent_jobs])
    for job in live_jobs:
        started = _as_utc(job.created_at) or now
        elapsed = max(0, int((now - started).total_seconds()))
        try:
            progress = json.loads(job.detail) if job.detail else {}
        except ValueError:
            progress = {}
        tasks.append({
            "request_id": job.job_id, "installation_id": requesting_client(log[job.job_id]), "app_id": None, "item_name": job.item_name,
            "source_kind": job.source_kind or "torrent", "source_host": "fragmentos", "requested_at": started,
            "elapsed_seconds": elapsed, "possibly_stuck": elapsed > int(_CACHE_PROCESSING_STALE_AFTER.total_seconds()),
            "status": job.status, "detail": progress, "events": log[job.job_id],
            "last_message": log[job.job_id][-1]["message"] if log[job.job_id] else "",
        })
    finished = [{
        "request_id": job.job_id, "item_name": job.item_name, "status": job.status, "at": _as_utc(job.updated_at),
        "installation_id": requesting_client(log[job.job_id]), "events": log[job.job_id],
    } for job in recent_jobs]
    for job in local_session.exec(
        select(VikingChunkJob).where(VikingChunkJob.status == "failed", VikingChunkJob.updated_at >= since)
        .order_by(VikingChunkJob.updated_at.desc()).limit(100)
    ).all():
        failures.append({
            "at": _as_utc(job.updated_at), "item_name": job.item_name, "source_kind": job.source_kind, "source_host": "fragmentos",
            "installation_id": "", "status": "failed", "error_code": job.error_code, "flow": "fragmentos", "job_id": job.job_id,
        })
        counts["failed"] = counts.get("failed", 0) + 1
    errors_by_job = {e["job_id"]: e for e in reversed(recent_errors(local_session, since))}
    for failure in failures:
        found = errors_by_job.get(failure.get("job_id", ""))
        if found:
            failure["message"] = found["message"]
            failure["installation_id"] = failure["installation_id"] or found["installation_id"]
    failures.sort(key=lambda f: f["at"] or now, reverse=True)
    return {
        "now": now,
        "finished": finished,
        "failures": failures[:100],
        "running_total": len(tasks),
        "running_torrents": sum(1 for task in tasks if task["source_kind"] == "torrent"),
        "running_direct": sum(1 for task in tasks if task["source_kind"] != "torrent"),
        "last_24h": {
            "completed": counts.get("completed", 0),
            "failed": counts.get("failed", 0),
            "rejected": counts.get("rejected", 0),
        },
        "tasks": tasks,
    }


@router.get("/admin/viking-tasks", response_class=HTMLResponse)
def viking_tasks_page(request: Request) -> HTMLResponse:
    """Admin page with the table of running TorBox -> ViKiNG tasks."""
    _admin_browser_access(request)
    page = Path(__file__).resolve().parents[1] / "admin" / "viking-tasks.html"
    return HTMLResponse(page.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})
