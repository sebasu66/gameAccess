"""Endpoints for the piece-by-piece TorBox -> ViKiNG download (PLUS only)."""
from __future__ import annotations

import asyncio
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlmodel import Session

from .access_keys import canonical_installation_id
from .access_overrides import CourtesySession, courtesy_access_tier
from .access_service import _activation_for_request
from .api_dependencies import get_session
from .local_database import get_local_session, local_engine
from .download_events import log_event
from .telemetry import record_transfer, record_transfers
from .viking_link_cache import link_cache, probe_direct_link
from .viking_map import VikingMapStore, restore_from_viking
from .link_sealing import seal
from .viking_cache_service import ProviderFailure, create_provider, magnet_infohash, normalize_source_url
from .viking_chunk_service import (
    build_manifest,
    create_job,
    find_job_for_source,
    get_job,
    get_ready_piece,
    get_ready_pieces,
    get_torbox_pieces,
    torbox_source,
    is_running,
    missing_for,
    start_job,
)

router = APIRouter(tags=["Viking chunks"])
logger = logging.getLogger("gameaccess.viking_chunks")


class ChunkJobRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=8192)
    item_name: str = Field(default="", max_length=300)
    file_name: str = Field(default="", max_length=300)
    # Pieces the player already downloaded (a resumed download): they are not uploaded again for it.
    have_pieces: list[int] = Field(default_factory=list, max_length=20000)


async def _installation_for_plus_async(request: Request, session: Session) -> str:
    """The license check touches the shared Supabase pool; run it off the event loop so one slow
    connection does not stall every other request this instance is handling at the same time."""
    return await run_in_threadpool(_installation_for_plus, request, session)


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


async def _sealed_torbox_links(job_id: str, pieces: list, request: Request, refresh: bool) -> list[dict]:
    """TorBox links for pieces ViKiNG is still importing, sealed for this player's session (a TorBox link carries
    the account's API key, so it never travels in plain text)."""
    source = torbox_source(job_id)
    if source is None or not pieces:
        return []
    auth = request.headers.get("Authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    installation = request.headers.get("X-GameAccess-Installation", "")
    links = []
    for piece in pieces:
        try:
            url = await source._link(piece.file_index, refresh=refresh)
        except ProviderFailure:
            continue  # the player waits for ViKiNG
        links.append({"index": piece.piece_index, "size": piece.size_bytes, "sha256": "", "source": "torbox",
                      "sealed": seal(url, token, installation)})
    return links


_served: set[tuple[str, str, str, int]] = set()


def _note_served(job_id: str, installation_id: str, source: str, indexes: list[int]) -> None:
    """The story says what the player got and from where: "archivo 2 desde Torbox", "archivo 2 desde Viking".

    Each (player, file, source) is told once; past the first 20 files only the first is told, so a game cut in
    hundreds of pieces does not flood the page."""
    where = "Viking" if source == "viking" else "Torbox (Viking todavía lo está copiando)"
    for index in sorted(set(indexes)):
        key = (job_id, installation_id, source, index)
        if key in _served or (index >= 20 and any(k[:3] == key[:3] for k in _served)):
            continue
        if len(_served) > 50000:
            _served.clear()
        _served.add(key)
        log_event(local_engine, job_id, "send", f"Se le envió al cliente el archivo {index + 1} desde {where}.",
                  status="ok", installation_id=installation_id)


def _safe_text(value: str, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


async def _known_or_restored(local_session: Session, fingerprint: str, source_url: str = ""):
    """The job of a source; one this server forgot (Render wipes its disk on every deploy) comes back from
    the map kept in its ViKiNG folder, so ViKiNG does not import the same game again."""
    job = find_job_for_source(local_session, fingerprint)
    if job is None and await restore_from_viking(
        local_session.get_bind(), fingerprint, source_url=source_url, store_factory=lambda: VikingMapStore(create_provider()),
    ):
        job = find_job_for_source(local_session, fingerprint)
    return job


@router.post("/downloads/viking-chunks")
async def start_chunk_download(
    req: ChunkJobRequest, request: Request, response: Response, session: Session = Depends(get_session),
    local_session: Session = Depends(get_local_session),
) -> dict:
    """Start (or resume, or join) the transfer of a source and return its manifest."""
    response.headers["Cache-Control"] = "no-store"
    installation_id = await _installation_for_plus_async(request, session)
    try:
        identity = normalize_source_url(req.source_url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    job = await _known_or_restored(local_session, identity.fingerprint, source_url=req.source_url.strip())
    existed = job is not None
    previous_error = job.error_code if job is not None else ""
    # preparing/running/ready: join it. failed (or never run in this process): resume with the same job.
    if job is None:
        job = create_job(
            local_session, fingerprint=identity.fingerprint, kind=identity.kind,
            item_name=_safe_text(req.item_name, 300), source_url=req.source_url.strip(),
        )
    have = {i for i in req.have_pieces if i >= 0}
    # failed, or "partial" without a piece this player lacks, or left unattended by a restart: run it again.
    needs_worker = (
        job.status == "failed"
        or missing_for(local_session, job, have)
        or (job.status in ("preparing", "running") and not is_running(job.job_id))
    )
    name = job.item_name or "un juego"
    if not existed:
        log_event(local_engine, job.job_id, "request", f"El cliente pidió «{name}»: no estaba en el caché, se prepara desde cero.", installation_id=installation_id, item_name=job.item_name)
    elif needs_worker:
        why = f" (la vez anterior terminó con: {previous_error})" if previous_error else ""
        log_event(local_engine, job.job_id, "resume", f"El cliente pidió «{name}»: el trabajo estaba detenido y se reanuda{why}.", installation_id=installation_id, item_name=job.item_name)
    elif job.status in ("ready", "partial"):
        log_event(local_engine, job.job_id, "cache", f"El cliente pidió «{name}»: ya estaba en el caché de Viking, se le respondió con las piezas existentes.", status="ok", installation_id=installation_id, item_name=job.item_name)
    else:
        log_event(local_engine, job.job_id, "request", f"El cliente pidió «{name}»: ya se estaba preparando, se une al mismo trabajo.", installation_id=installation_id, item_name=job.item_name)
    if needs_worker:
        job.status, job.error_code = "preparing", ""
        local_session.add(job)
        local_session.commit()
        start_job(
            local_engine, job.job_id, source_url=job.source_url or req.source_url.strip(), source_kind=identity.kind,
            source_host=identity.host, file_name=_safe_text(req.file_name, 300), fingerprint=identity.fingerprint,
            installation_id=installation_id, skip=have,
        )
        logger.info("chunk_job_started job=%s client=%s kind=%s", job.job_id[:8], installation_id, identity.kind)
    local_session.refresh(job)
    record_transfer(local_session, installation_id=installation_id, job_id=job.job_id, kind="start", item_name=job.item_name)
    return build_manifest(local_session, job)


class ChunkPeekRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=8192)


@router.post("/downloads/viking-chunks/peek")
async def peek_chunk_source(
    req: ChunkPeekRequest, request: Request, response: Response, session: Session = Depends(get_session),
    local_session: Session = Depends(get_local_session),
) -> dict:
    """Whether the server can serve this source at once, before the player measures the torrent itself.

    "viking": its pieces are already on ViKiNG; "torbox": TorBox already holds the torrent. Nothing is started."""
    response.headers["Cache-Control"] = "no-store"
    await _installation_for_plus_async(request, session)
    try:
        identity = normalize_source_url(req.source_url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    job = await _known_or_restored(local_session, identity.fingerprint)
    if job is not None and job.status in ("ready", "partial", "running"):
        return {"ready": True, "where": "viking"}
    info_hash = magnet_infohash(req.source_url)
    if info_hash:
        try:
            if await create_provider().torbox_has_cached(info_hash):
                return {"ready": True, "where": "torbox"}
        except ProviderFailure:
            pass  # unknown: the player decides by measuring the torrent
    return {"ready": False, "where": ""}


@router.get("/downloads/viking-chunks/{job_id}")
async def chunk_manifest(
    job_id: str, request: Request, response: Response, session: Session = Depends(get_session),
    local_session: Session = Depends(get_local_session),
) -> dict:
    """The player polls this: which pieces can already be downloaded."""
    response.headers["Cache-Control"] = "no-store"
    await _installation_for_plus_async(request, session)
    job = get_job(local_session, job_id)
    if job is None:
        raise HTTPException(404, "No existe esa descarga.")
    return build_manifest(local_session, job)


@router.get("/downloads/viking-chunks/{job_id}/pieces/{index}/link")
async def chunk_piece_link(
    job_id: str, index: int, request: Request, response: Response, session: Session = Depends(get_session),
    local_session: Session = Depends(get_local_session), refresh: bool = False,
) -> dict:
    """A working direct link for one ready piece (`refresh` asks for a new one because the player's did not work)."""
    response.headers["Cache-Control"] = "no-store"
    installation_id = await _installation_for_plus_async(request, session)
    piece = get_ready_piece(local_session, job_id, index)
    if piece is None:
        sealed = await _sealed_torbox_links(job_id, get_torbox_pieces(local_session, job_id, index, 1), request, refresh)
        if sealed:
            _note_served(job_id, installation_id, "torbox", [index])
            return sealed[0]
        raise HTTPException(404, "Esa pieza todavía no está lista.")
    try:
        url = await link_cache.get(piece.viking_hash, create_provider().resolve_viking_direct_link, probe_direct_link, refresh)
    except ProviderFailure as exc:
        raise HTTPException(exc.status_code, exc.public_message) from exc
    job = get_job(local_session, job_id)
    _note_served(job_id, installation_id, "viking", [piece.piece_index])
    record_transfer(
        local_session, installation_id=installation_id, job_id=job_id, kind="piece", piece_index=piece.piece_index,
        size_bytes=piece.size_bytes, item_name=job.item_name if job else "",
    )
    return {"index": piece.piece_index, "size": piece.size_bytes, "sha256": piece.sha256, "url": url}


MAX_LINKS_PER_CALL = 50


@router.get("/downloads/viking-chunks/{job_id}/links")
async def chunk_piece_links(
    job_id: str, request: Request, response: Response, start: int = 0, count: int = 12,
    session: Session = Depends(get_session), local_session: Session = Depends(get_local_session), refresh: bool = False,
) -> dict:
    """Direct links for the ready pieces in [start, start+count): one call instead of one per piece.

    Links come from a shared memory cache and are tried before being handed out; a new one is asked for only when
    ViKiNG refuses the cached one (or the player sends `refresh` because it did not work for them)."""
    response.headers["Cache-Control"] = "no-store"
    installation_id = await _installation_for_plus_async(request, session)
    start, count = max(0, start), max(1, min(count, MAX_LINKS_PER_CALL))
    pieces = get_ready_pieces(local_session, job_id, start, count)
    provider = create_provider()
    results = await asyncio.gather(
        *(link_cache.get(p.viking_hash, provider.resolve_viking_direct_link, probe_direct_link, refresh) for p in pieces),
        return_exceptions=True,
    )
    links, failure = [], None
    served = []
    for piece, result in zip(pieces, results):
        if isinstance(result, ProviderFailure):
            failure = failure or result
        elif isinstance(result, BaseException):
            raise result
        else:
            links.append({"index": piece.piece_index, "size": piece.size_bytes, "sha256": piece.sha256, "url": result})
            served.append(piece)
    sealed = await _sealed_torbox_links(job_id, get_torbox_pieces(local_session, job_id, start, count), request, refresh)
    links += sealed
    _note_served(job_id, installation_id, "viking", [p.piece_index for p in served])
    _note_served(job_id, installation_id, "torbox", [link["index"] for link in sealed])
    if failure is not None and not links:
        raise HTTPException(failure.status_code, failure.public_message) from failure
    if served:
        job = get_job(local_session, job_id)
        record_transfers(local_session, installation_id=installation_id, job_id=job_id, item_name=job.item_name if job else "", pieces=served)
    return {"links": links}


class ClientDownloadEvent(BaseModel):
    """What happened to a download on the player's PC, for the administrator's story of that download."""
    event: str = Field(pattern="^(measuring|torrent|server|started|finished|failed|cancelled)$")
    app_id: int = Field(default=0, ge=0)
    item_name: str = Field(default="", max_length=300)
    job_id: str = Field(default="", max_length=40)   # the server job, when the download goes through the server
    detail: str = Field(default="", max_length=300)  # the route's reason or the error, in the player's words
    bytes: int = Field(default=0, ge=0)
    seconds: float = Field(default=0, ge=0)


def client_event_message(event: ClientDownloadEvent) -> tuple[str, str]:
    """(message, status) in the same plain words as the server's own steps."""
    detail = _safe_text(event.detail, 300)
    why = f" ({detail})" if detail else ""
    if event.event == "measuring":
        return "El cliente está midiendo el torrent para elegir por dónde bajarlo.", "info"
    if event.event == "torrent":
        return f"El cliente baja el torrent directo, sin pasar por el servidor{why}.", "ok"
    if event.event == "server":
        return f"El cliente le pide el juego al servidor (Torbox → Viking){why}.", "info"
    if event.event == "started":
        return "El cliente empezó a descargar.", "info"
    if event.event == "finished":
        size = f"{event.bytes / 1e9:.1f} GB" if event.bytes else "la descarga"
        took = f" en {event.seconds / 60:.0f} min" if event.seconds >= 60 else (f" en {event.seconds:.0f} s" if event.seconds else "")
        speed = f" ({event.bytes / 1e6 / event.seconds:.1f} MB/s)" if event.bytes and event.seconds else ""
        return f"La descarga terminó en el cliente: {size}{took}{speed}.", "ok"
    if event.event == "cancelled":
        return "El cliente canceló la descarga.", "info"
    return f"La descarga falló en el cliente{why}.", "error"


@router.post("/downloads/client-events")
async def client_download_event(
    req: ClientDownloadEvent, request: Request, response: Response, session: Session = Depends(get_session),
) -> dict:
    """The player tells the server how its download went: route chosen, started, finished or failed."""
    response.headers["Cache-Control"] = "no-store"
    if await run_in_threadpool(_activation_for_request, request, session) is None:
        raise HTTPException(401, "Se requiere una activación vigente de GameAccess.")
    try:
        installation_id = canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
    except ValueError as exc:
        raise HTTPException(401, "La instalación de GameAccess no es válida.") from exc
    job_id = re.sub(r"[^A-Za-z0-9_-]", "", req.job_id)[:40] or f"app-{req.app_id}"
    message, status = client_event_message(req)
    log_event(local_engine, job_id, "client", message, status=status, installation_id=installation_id,
              item_name=_safe_text(req.item_name, 300))
    return {"ok": True}
