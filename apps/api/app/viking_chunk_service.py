"""Runs a TorBox -> ViKiNG transfer piece by piece so a player can start downloading early.

The worker never holds a whole game in memory: each piece goes to a temporary file (at most
two on disk at a time), is hashed on the way in, and is deleted as soon as ViKiNG has it.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import socket
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable, Protocol
from uuid import uuid4

import httpx
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from .viking_cache_service import ProviderFailure, TorBoxVikingProvider, TorboxItem, create_provider, torbox_summary
from .download_events import log_event
from .viking_chunk_models import VikingChunkJob, VikingChunkPiece
from .viking_chunk_plan import PlannedPiece, plan_pieces

logger = logging.getLogger("gameaccess.viking_chunks")

MAX_FILES = 200            # a source with more files than this is not worth splitting
PIECE_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 3.0
UPLOADS_IN_PARALLEL = 3       # pieces going up to ViKiNG at the same time (GAMEACCESS_CHUNK_UPLOADS)
MAX_PIECES_ON_DISK = UPLOADS_IN_PARALLEL + 1
LINK_TTL_SECONDS = 20 * 60
_PERMANENT_FAILURES = {"torbox_not_configured", "viking_invalid_upload_server"}


def viking_folder(job_id: str) -> str:
    """One ViKiNG folder per job keeps the pieces of a game together and out of the account root."""
    return f"GameAccess/{job_id[:8]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PieceSource(Protocol):
    async def fetch(self, piece: PlannedPiece, dest: Path) -> str:
        """Write the bytes of the piece to `dest` and return their sha256 (hex)."""


class PieceSink(Protocol):
    async def upload(self, path: Path, name: str, folder: str = "") -> str:
        """Upload the file (into `folder` when given) and return the id (hash) ViKiNG gave it."""


# ---------------------------------------------------------------- database helpers

def instance_id() -> str:
    """Stable name of this server: the same after a restart, different between local and Render."""
    explicit = os.getenv("GAMEACCESS_INSTANCE_ID", "").strip()
    if explicit:
        return explicit[:80]
    if os.getenv("RENDER_SERVICE_ID"):
        return ("render:" + os.environ["RENDER_SERVICE_ID"])[:80]
    return ("local:" + socket.gethostname())[:80]


def _touch(job: VikingChunkJob) -> None:
    job.updated_at = _now()


TORBOX_STATE_ES = {
    "downloading": "descargando el juego", "metadl": "leyendo los datos del torrent", "checking": "verificando",
    "checkingresumedata": "verificando", "stalled": "sin fuentes activas (estancado)", "stalleddl": "sin fuentes activas (estancado)",
    "queued": "en cola", "completed": "completo", "cached": "ya estaba guardado en Torbox", "uploading": "completo",
    "error": "con error", "paused": "en pausa",
}


def torbox_detail(item: dict[str, Any]) -> dict[str, Any]:
    """The few TorBox fields worth showing a player while the source is still being fetched."""
    def number(*keys: str) -> float:
        for key in keys:
            try:
                return float(item.get(key) or 0)
            except (TypeError, ValueError):
                continue
        return 0.0

    progress = number("progress")
    return {
        "stage": "torbox",
        "state": str(item.get("download_state") or item.get("status") or "")[:40],
        "progress": round(progress * 100 if progress <= 1 else progress, 1),
        "speed": int(number("download_speed")),
        "seeds": int(number("seeds")),
        "peers": int(number("peers")),
        "eta": int(number("eta")),
    }


def get_job(session: Session, job_id: str) -> VikingChunkJob | None:
    return session.exec(select(VikingChunkJob).where(VikingChunkJob.job_id == job_id)).first()


def find_job_for_source(session: Session, fingerprint: str) -> VikingChunkJob | None:
    """The newest job for a source; a failed one is resumed, so its ready pieces are not redone."""
    return session.exec(
        select(VikingChunkJob)
        .where(VikingChunkJob.source_fingerprint == fingerprint)
        .order_by(VikingChunkJob.id.desc())
    ).first()


def create_job(session: Session, *, fingerprint: str, kind: str, item_name: str, source_url: str = "") -> VikingChunkJob:
    now = _now()
    job = VikingChunkJob(
        job_id=uuid4().hex, source_fingerprint=fingerprint, source_kind=kind, source_url=source_url[:2000],
        item_name=item_name[:300], status="preparing", owner=instance_id(), created_at=now, updated_at=now,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def _set_job(engine: Engine, job_id: str, **changes: Any) -> None:
    with Session(engine) as session:
        job = get_job(session, job_id)
        if job is None:
            return
        for key, value in changes.items():
            setattr(job, key, value)
        _touch(job)
        session.add(job)
        session.commit()


def _fail_job(engine: Engine, job_id: str, code: str) -> None:
    _set_job(engine, job_id, status="failed", error_code=code[:80])


def _install_plan(engine: Engine, job_id: str, files: list[dict[str, Any]], plan: list[PlannedPiece]) -> set[int]:
    """Create the piece rows (or keep them when the plan is unchanged) and return the ready indexes."""
    with Session(engine) as session:
        existing = session.exec(select(VikingChunkPiece).where(VikingChunkPiece.job_id == job_id)).all()
        wanted = [(p.index, p.file_index, p.start, p.size) for p in plan]
        have = sorted((r.piece_index, r.file_index, r.start_byte, r.size_bytes) for r in existing)
        if have != wanted:
            for row in existing:
                session.delete(row)
            session.commit()
            now = _now()
            session.add_all([
                VikingChunkPiece(
                    job_id=job_id, piece_index=p.index, file_index=p.file_index,
                    start_byte=p.start, size_bytes=p.size, status="pending", updated_at=now,
                )
                for p in plan
            ])
            existing = []
        job = get_job(session, job_id)
        if job is not None:
            job.files_json = json.dumps([{"index": i, "name": f["name"], "size": f["size"]} for i, f in enumerate(files)])
            job.total_bytes = sum(int(f["size"]) for f in files)
            _touch(job)
            session.add(job)
        session.commit()
        return {r.piece_index for r in existing if r.status == "ready" and r.viking_hash} if have == wanted else set()


def _mark_piece_ready(engine: Engine, job_id: str, index: int, sha256: str, viking_hash: str) -> None:
    with Session(engine) as session:
        piece = session.exec(
            select(VikingChunkPiece).where(VikingChunkPiece.job_id == job_id, VikingChunkPiece.piece_index == index)
        ).first()
        if piece is None:
            return
        piece.sha256, piece.viking_hash, piece.status, piece.updated_at = sha256, viking_hash, "ready", _now()
        session.add(piece)
        job = get_job(session, job_id)
        if job is not None:
            _touch(job)
            session.add(job)
        session.commit()


def build_manifest(session: Session, job: VikingChunkJob) -> dict[str, Any]:
    """What a player needs: the files, and every planned piece with whether it can be fetched yet."""
    pieces = session.exec(
        select(VikingChunkPiece).where(VikingChunkPiece.job_id == job.job_id).order_by(VikingChunkPiece.piece_index)
    ).all()
    return {
        "job_id": job.job_id,
        "status": job.status,
        "error": job.error_code,
        "detail": json.loads(job.detail) if job.detail else {},
        "item_name": job.item_name,
        "total_bytes": job.total_bytes,
        "files": json.loads(job.files_json or "[]"),
        "piece_count": len(pieces),
        "ready_count": sum(1 for p in pieces if p.status == "ready"),
        "pieces": [
            {
                "index": p.piece_index, "file_index": p.file_index, "start": p.start_byte, "size": p.size_bytes,
                "sha256": p.sha256 if p.status == "ready" else "", "ready": p.status == "ready",
            }
            for p in pieces
        ],
    }


def get_ready_piece(session: Session, job_id: str, index: int) -> VikingChunkPiece | None:
    piece = session.exec(
        select(VikingChunkPiece).where(VikingChunkPiece.job_id == job_id, VikingChunkPiece.piece_index == index)
    ).first()
    return piece if piece is not None and piece.status == "ready" and piece.viking_hash else None


def get_ready_pieces(session: Session, job_id: str, start: int, count: int) -> list[VikingChunkPiece]:
    """The ready pieces with index in [start, start+count), in order (one query for the whole batch)."""
    return list(session.exec(
        select(VikingChunkPiece)
        .where(
            VikingChunkPiece.job_id == job_id, VikingChunkPiece.status == "ready", VikingChunkPiece.viking_hash.is_not(None),
            VikingChunkPiece.piece_index >= start, VikingChunkPiece.piece_index < start + count,
        )
        .order_by(VikingChunkPiece.piece_index)
    ).all())


def missing_for(session: Session, job: VikingChunkJob, have: set[int]) -> bool:
    """Whether a player that already holds `have` still needs a piece this job has not put on ViKiNG.

    A job can end "partial": it skipped the pieces the player who asked for it already had (a resumed download)."""
    if job.status != "partial":
        return False
    pieces = session.exec(select(VikingChunkPiece).where(VikingChunkPiece.job_id == job.job_id)).all()
    return any(p.status != "ready" and p.piece_index not in have for p in pieces)


def recover_interrupted_chunk_jobs(engine: Engine) -> int:
    """After a restart nothing is working on this server's jobs the database calls active; fail them so they resume.

    Jobs owned by another server sharing the database are left alone (they are still running there)."""
    with Session(engine) as session:
        jobs = session.exec(
            select(VikingChunkJob).where(
                VikingChunkJob.status.in_(("preparing", "running")),
                VikingChunkJob.owner.in_((instance_id(), "")),
            )
        ).all()
        for job in jobs:
            job.status, job.error_code = "failed", "server_restarted"
            _touch(job)
            session.add(job)
        session.commit()
        return len(jobs)


# ---------------------------------------------------------------- the transfer itself

async def _sleep(seconds: float) -> None:  # replaced in tests
    await asyncio.sleep(seconds)


async def _retry(factory: Callable[[], Awaitable[Any]]) -> Any:
    for attempt in range(1, PIECE_ATTEMPTS + 1):
        try:
            return await factory()
        except (httpx.HTTPError, OSError, RuntimeError, ProviderFailure) as exc:
            permanent = isinstance(exc, ProviderFailure) and exc.code in _PERMANENT_FAILURES
            if attempt == PIECE_ATTEMPTS or permanent:
                raise
            logger.warning("chunk_retry attempt=%s error=%s", attempt, type(exc).__name__)
            await _sleep(RETRY_DELAY_SECONDS * attempt)


async def _transfer(
    engine: Engine, job_id: str, pending: list[PlannedPiece], source: PieceSource, sink: PieceSink,
    work_dir: Path, name_for: Callable[[PlannedPiece], str], folder: str = "", uploads: int | None = None,
    note: Callable[..., None] | None = None,
) -> None:
    """Fetch pieces one after another while up to `uploads` of them go up to ViKiNG at once.

    At most `uploads + 1` piece files exist on disk at any moment.
    """
    workers = max(1, uploads if uploads is not None else int(os.getenv("GAMEACCESS_CHUNK_UPLOADS") or UPLOADS_IN_PARALLEL))
    slots = asyncio.Semaphore(workers + 1)
    queue: asyncio.Queue = asyncio.Queue()
    total, finished, every = len(pending), 0, max(1, len(pending) // 10)

    async def producer() -> None:
        try:
            for piece in pending:
                await slots.acquire()
                path = work_dir / f"{job_id}-{piece.index:04d}.part"
                try:
                    sha = await _retry(lambda: source.fetch(piece, path))
                except BaseException:
                    path.unlink(missing_ok=True)
                    slots.release()
                    raise
                await queue.put((piece, path, sha))
        finally:
            for _ in range(workers):
                await queue.put(None)

    async def consumer() -> None:
        while True:
            item = await queue.get()
            if item is None:
                return
            piece, path, sha = item
            try:
                viking_hash = await _retry(lambda: sink.upload(path, name_for(piece), folder))
                _mark_piece_ready(engine, job_id, piece.index, sha, viking_hash)
                logger.info("chunk_ready job=%s piece=%s size=%s", job_id[:8], piece.index, piece.size)
                nonlocal finished
                finished += 1
                if note is not None and (finished == 1 or finished == total or finished % every == 0):
                    note("viking", f"Paso 2 · Pieza {piece.index + 1} ya está en Viking ({finished} de {total} pendientes).")
            finally:
                path.unlink(missing_ok=True)
                slots.release()

    tasks = [asyncio.create_task(producer())] + [asyncio.create_task(consumer()) for _ in range(workers)]
    try:
        await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for leftover in work_dir.glob(f"{job_id}-*.part"):
            leftover.unlink(missing_ok=True)
        raise


async def run_chunk_job(
    engine: Engine, job_id: str, *,
    prepare: Callable[[], Awaitable[tuple[PieceSource, list[dict[str, Any]]]]],
    sink: PieceSink, work_dir: Path, installation_id: str = "", skip: Iterable[int] = (),
) -> None:
    """Prepare the source, plan the pieces and move every missing one to ViKiNG.

    `skip` are pieces the player who asked already holds (a download resumed after the server lost its job):
    they are not uploaded, and the job ends "partial" so whoever needs them later gets them uploaded."""
    source: Any = None

    def note(step: str, message: str, status: str = "info") -> None:
        log_event(engine, job_id, step, message, status=status, installation_id=installation_id)

    try:
        work_dir.mkdir(parents=True, exist_ok=True)
        note("torbox", "Paso 1 · Pidiéndole el juego a Torbox.")
        source, files = await prepare()
        note("torbox", f"Paso 1 · Torbox ya tiene el juego ({len(files)} archivo{'s' if len(files) != 1 else ''}).", "ok")
        if len(files) > MAX_FILES:
            raise ProviderFailure("too_many_files", 422, "Esta fuente tiene demasiados archivos para enviarla por piezas.")
        plan = plan_pieces([int(f["size"]) for f in files])
        if not plan:
            raise ProviderFailure("torbox_no_files", 502, "TorBox no informó los archivos de esta fuente.")
        ready = _install_plan(engine, job_id, files, plan)
        _set_job(engine, job_id, status="running", error_code="")
        held = set(skip) - ready
        pending = [p for p in plan if p.index not in ready and p.index not in held]
        logger.info("chunk_job_running job=%s pieces=%s pending=%s client_has=%s", job_id[:8], len(plan), len(pending), len(held))
        has = f", el cliente ya tiene {len(held)}" if held else ""
        note("viking", f"Paso 2 · Pasando el juego a Viking en {len(plan)} piezas ({len(ready)} ya estaban listas{has}).")
        await _transfer(
            engine, job_id, pending, source, sink, work_dir,
            lambda p: f"ga-{job_id[:8]}.p{p.index:04d}", viking_folder(job_id), note=note,
        )
        if held:
            _set_job(engine, job_id, status="partial", completed_at=_now())
            note("ready", f"Listo: subidas las {len(pending)} piezas que le faltaban al cliente (las otras {len(held)} ya las tenía).", "ok")
        else:
            _set_job(engine, job_id, status="ready", completed_at=_now())
            note("ready", f"Listo: las {len(plan)} piezas están disponibles para el cliente.", "ok")
        logger.info("chunk_job_ready job=%s", job_id[:8])
    except asyncio.CancelledError:
        _fail_job(engine, job_id, "server_stopped")
        note("error", "El servidor se detuvo mientras trabajaba (se retoma cuando el cliente vuelva a pedirlo).", "error")
        raise
    except ProviderFailure as exc:
        logger.error("chunk_job_failed job=%s code=%s", job_id[:8], exc.code)
        _fail_job(engine, job_id, exc.code)
        note("error", f"Falló: {getattr(exc, 'public_message', '') or exc.code} [{exc.code}]", "error")
    except Exception as exc:  # noqa: BLE001 - the job row must always leave "running"
        logger.exception("chunk_job_crashed job=%s", job_id[:8])
        _fail_job(engine, job_id, "unexpected_error")
        note("error", f"Error inesperado del servidor: {type(exc).__name__}.", "error")
    finally:
        closer = getattr(source, "aclose", None)
        if closer is not None:
            await closer()


# ---------------------------------------------------------------- production source and sink

class _LinkExpired(Exception):
    pass


class TorboxRangeSource:
    """Reads byte ranges of the files of a finished TorBox item."""

    def __init__(self, provider: TorBoxVikingProvider, api_client: httpx.AsyncClient, item: TorboxItem, files: list[dict[str, Any]]):
        self.provider, self.api_client, self.item, self.files = provider, api_client, item, files
        self._links: dict[int, tuple[str, float]] = {}
        self._http = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=20.0), transport=provider.transport, follow_redirects=True,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _link(self, file_index: int, *, refresh: bool) -> str:
        cached = self._links.get(file_index)
        loop_time = asyncio.get_running_loop().time()
        if cached and not refresh and cached[1] > loop_time:
            return cached[0]
        link = await self.provider.torbox_file_link(self.api_client, self.item, self.files[file_index]["id"])
        self._links[file_index] = (link, loop_time + LINK_TTL_SECONDS)
        return link

    async def fetch(self, piece: PlannedPiece, dest: Path) -> str:
        for refresh in (False, True):
            url = await self._link(piece.file_index, refresh=refresh)
            try:
                return await self._download(url, piece, dest)
            except _LinkExpired:
                continue
        raise ProviderFailure("torbox_link_expired", 502, "TorBox rechazó el enlace temporal del archivo.")

    async def _download(self, url: str, piece: PlannedPiece, dest: Path) -> str:
        digest = hashlib.sha256()
        written = 0
        async with self._http.stream("GET", url, headers={"Range": f"bytes={piece.start}-{piece.end}"}) as response:
            if response.status_code in (401, 403, 404, 410):
                raise _LinkExpired()
            if response.status_code != 206:
                raise RuntimeError(f"TorBox respondió {response.status_code} al pedir un rango")
            with dest.open("wb") as handle:
                async for chunk in response.aiter_bytes(1 << 20):
                    handle.write(chunk)
                    digest.update(chunk)
                    written += len(chunk)
        if written != piece.size:
            raise RuntimeError(f"pieza incompleta: {written} de {piece.size} bytes")
        return digest.hexdigest()


class VikingFileSink:
    def __init__(self, provider: TorBoxVikingProvider):
        self.provider = provider

    async def upload(self, path: Path, name: str, folder: str = "") -> str:
        result = await self.provider.upload_file_to_viking(path, name, folder)
        file_hash = str(result.get("hash") or "").strip()
        if not file_hash:
            raise ProviderFailure("viking_upload_invalid_response", 502, "ViKiNG no devolvió el identificador del archivo.")
        return file_hash


# ---------------------------------------------------------------- starting jobs from the API

_running: dict[str, asyncio.Task] = {}
_slots: asyncio.Semaphore | None = None


def default_work_dir() -> Path:
    return Path(os.getenv("GAMEACCESS_CHUNK_WORK_DIR") or Path(tempfile.gettempdir()) / "gameaccess-chunks")


def is_running(job_id: str) -> bool:
    return job_id in _running


def start_job(
    engine: Engine, job_id: str, *, source_url: str, source_kind: str, source_host: str, file_name: str,
    fingerprint: str, installation_id: str, provider: TorBoxVikingProvider | None = None, work_dir: Path | None = None,
    skip: Iterable[int] = (),
) -> asyncio.Task:
    """Run the job in the background. Only a few jobs move data at once; the rest wait as "preparing"."""
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(max(1, int(os.getenv("GAMEACCESS_CHUNK_MAX_JOBS", "2"))))
    slots = _slots

    async def runner() -> None:
        async with slots:
            worker = provider or create_provider()
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=15.0), transport=worker.transport, follow_redirects=False,
            ) as api_client:
                last_state: list[Any] = [None]

                async def report(torbox_item: dict[str, Any]) -> None:
                    detail = {**torbox_detail(torbox_item), "queue": torbox_summary()}  # what Torbox is doing overall
                    _set_job(engine, job_id, detail=json.dumps(detail))
                    marker = (detail["state"], int(detail["progress"] // 10))
                    if marker != last_state[0]:
                        last_state[0] = marker
                        words = TORBOX_STATE_ES.get(str(detail["state"]).lower(), str(detail["state"]) or "esperando")
                        seeds = f", {detail['seeds']} fuentes" if detail["seeds"] else ""
                        log_event(engine, job_id, "torbox", f"Paso 1 · Torbox: {words} {detail['progress']:.0f}%{seeds}.", installation_id=installation_id)

                async def prepare() -> tuple[PieceSource, list[dict[str, Any]]]:
                    item, files = await worker.prepare_chunk_source(
                        api_client, source_url=source_url, source_kind=source_kind, source_host=source_host,
                        file_name=file_name, request_id=job_id, installation_id=installation_id, fingerprint=fingerprint,
                        on_status=report,
                    )
                    return TorboxRangeSource(worker, api_client, item, files), files

                await run_chunk_job(engine, job_id, prepare=prepare, sink=VikingFileSink(worker), work_dir=work_dir or default_work_dir(), installation_id=installation_id, skip=skip)

    task = asyncio.create_task(runner())
    _running[job_id] = task
    task.add_done_callback(lambda _t: _running.pop(job_id, None))
    return task
