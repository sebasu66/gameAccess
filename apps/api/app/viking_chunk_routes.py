"""Endpoints for the piece-by-piece TorBox -> ViKiNG download (PLUS only)."""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlmodel import Session

from .access_keys import canonical_installation_id
from .access_overrides import CourtesySession, courtesy_access_tier
from .access_service import _activation_for_request
from .api_dependencies import get_session
from .database import engine
from .download_events import log_event
from .telemetry import record_transfer
from .viking_cache_service import ProviderFailure, create_provider, normalize_source_url
from .viking_chunk_service import (
    build_manifest,
    create_job,
    find_job_for_source,
    get_job,
    get_ready_piece,
    is_running,
    start_job,
)

router = APIRouter(tags=["Viking chunks"])
logger = logging.getLogger("gameaccess.viking_chunks")


class ChunkJobRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=8192)
    item_name: str = Field(default="", max_length=300)
    file_name: str = Field(default="", max_length=300)


def _installation_for_plus(request: Request, session: Session) -> str:
    access = _activation_for_request(request, session)
    if access is None:
        raise HTTPException(401, "Se requiere una activación vigente de GameAccess.")
    try:
        installation_id = canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
    except ValueError as exc:
        raise HTTPException(401, "La instalación de GameAccess no es válida.") from exc
    tier = courtesy_access_tier(access) if isinstance(access, CourtesySession) else access.access_tier
    if tier != "plus":
        raise HTTPException(403, "La descarga por piezas requiere el plan PLUS.")
    return installation_id


def _safe_text(value: str, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


@router.post("/downloads/viking-chunks")
async def start_chunk_download(
    req: ChunkJobRequest, request: Request, response: Response, session: Session = Depends(get_session),
) -> dict:
    """Start (or resume, or join) the transfer of a source and return its manifest."""
    response.headers["Cache-Control"] = "no-store"
    installation_id = _installation_for_plus(request, session)
    try:
        identity = normalize_source_url(req.source_url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    job = find_job_for_source(session, identity.fingerprint)
    existed = job is not None
    previous_error = job.error_code if job is not None else ""
    # preparing/running/ready: join it. failed (or never run in this process): resume with the same job.
    if job is None:
        job = create_job(
            session, fingerprint=identity.fingerprint, kind=identity.kind,
            item_name=_safe_text(req.item_name, 300), source_url=req.source_url.strip(),
        )
    needs_worker = job.status == "failed" or (job.status in ("preparing", "running") and not is_running(job.job_id))
    name = job.item_name or "un juego"
    if not existed:
        log_event(engine, job.job_id, "request", f"El cliente pidió «{name}»: no estaba en el caché, se prepara desde cero.", installation_id=installation_id, item_name=job.item_name)
    elif needs_worker:
        why = f" (la vez anterior terminó con: {previous_error})" if previous_error else ""
        log_event(engine, job.job_id, "resume", f"El cliente pidió «{name}»: el trabajo estaba detenido y se reanuda{why}.", installation_id=installation_id, item_name=job.item_name)
    elif job.status == "ready":
        log_event(engine, job.job_id, "cache", f"El cliente pidió «{name}»: ya estaba en el caché de Viking, se le respondió con las piezas existentes.", status="ok", installation_id=installation_id, item_name=job.item_name)
    else:
        log_event(engine, job.job_id, "request", f"El cliente pidió «{name}»: ya se estaba preparando, se une al mismo trabajo.", installation_id=installation_id, item_name=job.item_name)
    if needs_worker:
        job.status, job.error_code = "preparing", ""
        session.add(job)
        session.commit()
        start_job(
            engine, job.job_id, source_url=job.source_url or req.source_url.strip(), source_kind=identity.kind,
            source_host=identity.host, file_name=_safe_text(req.file_name, 300), fingerprint=identity.fingerprint,
            installation_id=installation_id,
        )
        logger.info("chunk_job_started job=%s client=%s kind=%s", job.job_id[:8], installation_id, identity.kind)
    session.refresh(job)
    record_transfer(session, installation_id=installation_id, job_id=job.job_id, kind="start", item_name=job.item_name)
    return build_manifest(session, job)


@router.get("/downloads/viking-chunks/{job_id}")
async def chunk_manifest(
    job_id: str, request: Request, response: Response, session: Session = Depends(get_session),
) -> dict:
    """The player polls this: which pieces can already be downloaded."""
    response.headers["Cache-Control"] = "no-store"
    _installation_for_plus(request, session)
    job = get_job(session, job_id)
    if job is None:
        raise HTTPException(404, "No existe esa descarga.")
    return build_manifest(session, job)


@router.get("/downloads/viking-chunks/{job_id}/pieces/{index}/link")
async def chunk_piece_link(
    job_id: str, index: int, request: Request, response: Response, session: Session = Depends(get_session),
) -> dict:
    """A fresh direct link for one ready piece (links are signed and expire)."""
    response.headers["Cache-Control"] = "no-store"
    installation_id = _installation_for_plus(request, session)
    piece = get_ready_piece(session, job_id, index)
    if piece is None:
        raise HTTPException(404, "Esa pieza todavía no está lista.")
    try:
        url = await create_provider().resolve_viking_direct_link(piece.viking_hash)
    except ProviderFailure as exc:
        raise HTTPException(exc.status_code, exc.public_message) from exc
    job = get_job(session, job_id)
    record_transfer(
        session, installation_id=installation_id, job_id=job_id, kind="piece", piece_index=piece.piece_index,
        size_bytes=piece.size_bytes, item_name=job.item_name if job else "",
    )
    return {"index": piece.piece_index, "size": piece.size_bytes, "sha256": piece.sha256, "url": url}
