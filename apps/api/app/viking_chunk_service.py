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
from .viking_map import MapStore, VikingMapStore, folder_for, map_document, piece_name
from . import resource_governor

logger = logging.getLogger("gameaccess.viking_chunks")

MAX_FILES = 200            # a source with more files than this is not worth splitting
PIECE_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 3.0
FETCHES_IN_PARALLEL = 2       # pieces read from TorBox at the same time (GAMEACCESS_CHUNK_FETCHES)
UPLOADS_IN_PARALLEL = 3       # pieces going up to ViKiNG at the same time (GAMEACCESS_CHUNK_UPLOADS)
MAX_PIECES_ON_DISK = FETCHES_IN_PARALLEL + UPLOADS_IN_PARALLEL
DISK_BUDGET_MB = 2000         # piece files on disk at once, all together (GAMEACCESS_CHUNK_DISK_MB); one piece always fits
IMPORTS_IN_PARALLEL = 4       # files ViKiNG imports from TorBox at once in remote mode (GAMEACCESS_CHUNK_IMPORTS)
# "remote": ViKiNG downloads each TorBox file itself (no byte goes through this server, which only coordinates);
# "pieces": this server reads byte ranges from TorBox and uploads them (the player starts sooner on one big file).
DEFAULT_MODE = "remote"       # GAMEACCESS_CHUNK_MODE
LINK_TTL_SECONDS = 20 * 60
_PERMANENT_FAILURES = {"torbox_not_configured", "viking_invalid_upload_server"}


# While ViKiNG imports a job's files, players get each file straight from TorBox (sealed link) instead of waiting:
# job_id -> the TorBox source of the running import. In memory only: after a restart the player waits for ViKiNG.
_torbox_sources: dict[str, Any] = {}


def torbox_source(job_id: str) -> Any:
    return _torbox_sources.get(job_id)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PieceSource(Protocol):
    async def fetch(self, piece: PlannedPiece, dest: Path) -> str:
        """Write the bytes of the piece to `dest` and return their sha256 (hex)."""


class RemoteImporter(Protocol):
    async def import_file(self, piece: PlannedPiece, name: str, folder: str = "", refresh: bool = False) -> str:
        """Have ViKiNG fetch the whole file of the piece by itself and return the id (hash) ViKiNG gave it."""


def whole_file_plan(sizes: list[int]) -> list[PlannedPiece]:
    """Remote mode: one piece per file, the whole file (empty files need no piece)."""
    plan: list[PlannedPiece] = []
    for file_index, size in enumerate(int(s) for s in sizes):
        if size > 0:
            plan.append(PlannedPiece(len(plan), file_index, 0, size - 1))
    return plan


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


def _ready_hashes(engine: Engine, job_id: str) -> dict[int, str]:
    with Session(engine) as session:
        pieces = session.exec(select(VikingChunkPiece).where(VikingChunkPiece.job_id == job_id, VikingChunkPiece.status == "ready")).all()
        return {p.piece_index: p.sha256 for p in pieces if p.sha256}


def build_manifest(session: Session, job: VikingChunkJob) -> dict[str, Any]:
    """What a player needs: the files, and every planned piece with whether it can be fetched yet."""
    pieces = session.exec(
        select(VikingChunkPiece).where(VikingChunkPiece.job_id == job.job_id).order_by(VikingChunkPiece.piece_index)
    ).all()
    from_torbox = job.job_id in _torbox_sources
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
                "sha256": p.sha256 if p.status == "ready" else "",
                "ready": p.status == "ready" or (from_torbox and p.status == "pending"),
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


def get_torbox_pieces(session: Session, job_id: str, start: int, count: int) -> list[VikingChunkPiece]:
    """Pieces in [start, start+count) still being imported, which players get from TorBox meanwhile."""
    if job_id not in _torbox_sources:
        return []
    return list(session.exec(
        select(VikingChunkPiece)
        .where(VikingChunkPiece.job_id == job_id, VikingChunkPiece.status == "pending",
               VikingChunkPiece.piece_index >= start, VikingChunkPiece.piece_index < start + count)
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
    note: Callable[..., None] | None = None, fetches: int | None = None, disk_budget: int | None = None,
) -> None:
    """Read up to `fetches` pieces from TorBox at once while up to `uploads` go up to ViKiNG at once.

    Pieces are started in order, so the first ones are ready first. At most `fetches + uploads` piece files
    exist on disk, and together they stay under `disk_budget` bytes (a piece bigger than that goes alone).
    Each stage logs its speed, so the slow one shows in the log.
    """
    workers = max(1, uploads if uploads is not None else int(os.getenv("GAMEACCESS_CHUNK_UPLOADS") or UPLOADS_IN_PARALLEL))
    readers = max(1, fetches if fetches is not None else int(os.getenv("GAMEACCESS_CHUNK_FETCHES") or FETCHES_IN_PARALLEL))
    budget = disk_budget if disk_budget is not None else int(os.getenv("GAMEACCESS_CHUNK_DISK_MB") or DISK_BUDGET_MB) << 20
    slots = asyncio.Semaphore(readers + workers)
    disk = asyncio.Condition()
    on_disk = 0
    queue: asyncio.Queue = asyncio.Queue()
    todo = list(pending)
    total, finished, every = len(pending), 0, max(1, len(pending) // 10)
    timing = {"fetch_bytes": 0, "fetch_seconds": 0.0, "upload_bytes": 0, "upload_seconds": 0.0}
    loop = asyncio.get_running_loop()

    async def reserve(size: int) -> None:
        nonlocal on_disk
        async with disk:
            await disk.wait_for(lambda: on_disk == 0 or on_disk + size <= budget)
            on_disk += size

    async def free(size: int) -> None:
        nonlocal on_disk
        async with disk:
            on_disk -= size
            disk.notify_all()

    def speed(stage: str) -> float:
        seconds = timing[f"{stage}_seconds"]
        return timing[f"{stage}_bytes"] / seconds / 1e6 if seconds > 0 else 0.0

    governor = resource_governor.current()

    async def reader() -> None:
        while todo:
            piece = todo.pop(0)
            await slots.acquire()
            await reserve(piece.size)
            # The piece will go up to ViKiNG through this server: it waits while the CPU is busy and needs the
            # month's traffic budget to allow it (resource_governor.py).
            if governor is not None:
                while not governor.cpu_ok():
                    await _sleep(2)
                if not governor.approve(piece.size):
                    await free(piece.size)
                    slots.release()
                    raise ProviderFailure("server_budget_exhausted", 503, "El servidor llegó a su límite de tráfico del mes.")
            path = work_dir / f"{job_id}-{piece.index:04d}.part"
            started = loop.time()
            try:
                sha = await _retry(lambda: source.fetch(piece, path))
            except BaseException:
                path.unlink(missing_ok=True)
                await free(piece.size)
                slots.release()
                if governor is not None:
                    governor.release(piece.size, sent=False)
                raise
            took = max(loop.time() - started, 0.001)
            timing["fetch_bytes"] += piece.size
            timing["fetch_seconds"] += took
            logger.info("chunk_fetched job=%s piece=%s mb=%.0f seconds=%.1f mbps=%.1f",
                        job_id[:8], piece.index, piece.size / 1e6, took, piece.size / 1e6 / took)
            await queue.put((piece, path, sha))

    async def readers_then_stop() -> None:
        try:
            await asyncio.gather(*(reader() for _ in range(readers)))
        finally:
            for _ in range(workers):
                await queue.put(None)

    async def consumer() -> None:
        nonlocal finished
        while True:
            item = await queue.get()
            if item is None:
                return
            piece, path, sha = item
            started = loop.time()
            sent = False
            try:
                viking_hash = await _retry(lambda: sink.upload(path, name_for(piece), folder))
                sent = True
                took = max(loop.time() - started, 0.001)
                timing["upload_bytes"] += piece.size
                timing["upload_seconds"] += took
                _mark_piece_ready(engine, job_id, piece.index, sha, viking_hash)
                logger.info("chunk_ready job=%s piece=%s size=%s upload_seconds=%.1f upload_mbps=%.1f",
                            job_id[:8], piece.index, piece.size, took, piece.size / 1e6 / took)
                finished += 1
                if note is not None and (finished == 1 or finished == total or finished % every == 0):
                    note("viking", f"Paso 2 · Pieza {piece.index + 1} ya está en Viking ({finished} de {total} pendientes). "
                                   f"Por conexión: Torbox {speed('fetch'):.1f} MB/s, subida a Viking {speed('upload'):.1f} MB/s "
                                   f"({readers} lecturas y {workers} subidas a la vez).")
            finally:
                path.unlink(missing_ok=True)
                await free(piece.size)
                slots.release()
                if governor is not None:
                    governor.release(piece.size, sent=sent)

    tasks = [asyncio.create_task(readers_then_stop())] + [asyncio.create_task(consumer()) for _ in range(workers)]
    try:
        await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        while not queue.empty():  # pieces read but never uploaded give their budget back
            item = queue.get_nowait()
            if item is not None and governor is not None:
                governor.release(item[0].size, sent=False)
        for leftover in work_dir.glob(f"{job_id}-*.part"):
            leftover.unlink(missing_ok=True)
        raise


async def _import_remote(
    engine: Engine, job_id: str, pending: list[PlannedPiece], importer: RemoteImporter,
    name_for: Callable[[PlannedPiece], str], folder: str = "", imports: int | None = None,
    note: Callable[..., None] | None = None,
) -> None:
    """Have ViKiNG import up to `imports` files at once; each one is ready for players as soon as ViKiNG has it."""
    workers = max(1, imports if imports is not None else int(os.getenv("GAMEACCESS_CHUNK_IMPORTS") or IMPORTS_IN_PARALLEL))
    slots = asyncio.Semaphore(workers)
    total, finished, every = len(pending), 0, max(1, len(pending) // 10)
    loop = asyncio.get_running_loop()

    async def one(piece: PlannedPiece) -> None:
        nonlocal finished
        async with slots:
            started = loop.time()
            tries = {"n": 0}

            async def attempt() -> str:
                tries["n"] += 1
                return await importer.import_file(piece, name_for(piece), folder, refresh=tries["n"] > 1)

            viking_hash = await _retry(attempt)
            took = max(loop.time() - started, 0.001)
            _mark_piece_ready(engine, job_id, piece.index, "", viking_hash)
            logger.info("chunk_imported job=%s piece=%s mb=%.0f seconds=%.1f mbps=%.1f attempts=%s",
                        job_id[:8], piece.index, piece.size / 1e6, took, piece.size / 1e6 / took, tries["n"])
            finished += 1
            if note is not None and (finished == 1 or finished == total or finished % every == 0):
                note("viking", f"Paso 2 · Archivo {piece.index + 1} ya está en Viking ({finished} de {total}); "
                               f"Viking lo bajó de Torbox a {piece.size / 1e6 / took:.1f} MB/s ({workers} a la vez).")

    tasks = [asyncio.create_task(one(piece)) for piece in pending]
    try:
        await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


async def run_chunk_job(
    engine: Engine, job_id: str, *,
    prepare: Callable[[], Awaitable[tuple[PieceSource, list[dict[str, Any]]]]],
    sink: PieceSink, work_dir: Path, installation_id: str = "", skip: Iterable[int] = (),
    importer: Callable[[PieceSource], RemoteImporter] | None = None, maps: MapStore | None = None,
) -> None:
    """Prepare the source, plan the pieces and move every missing one to ViKiNG.

    The pieces go to the source's own ViKiNG folder, with the map that lets a server that forgot the source
    (Render wipes its disk on every deploy) find them again (viking_map.py).

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
        remote = importer(source) if importer is not None else None
        plan = whole_file_plan([int(f["size"]) for f in files]) if remote else plan_pieces([int(f["size"]) for f in files])
        if not plan:
            raise ProviderFailure("torbox_no_files", 502, "TorBox no informó los archivos de esta fuente.")
        ready = _install_plan(engine, job_id, files, plan)
        with Session(engine) as session:
            job = get_job(session, job_id)
        fingerprint = job.source_fingerprint if job is not None else job_id
        folder = folder_for(fingerprint)
        if maps is not None and job is not None:
            await maps.save(folder, map_document(job, files, plan, _ready_hashes(engine, job_id)))
        _set_job(engine, job_id, status="running", error_code="")
        held = set(skip) - ready
        pending = [p for p in plan if p.index not in ready and p.index not in held]
        logger.info("chunk_job_running job=%s pieces=%s pending=%s client_has=%s", job_id[:8], len(plan), len(pending), len(held))
        has = f", el cliente ya tiene {len(held)}" if held else ""
        note("viking", f"Paso 2 · Pasando el juego a Viking en {len(plan)} piezas ({len(ready)} ya estaban listas{has}).")
        name_for = lambda p: piece_name(fingerprint, p.index)  # noqa: E731
        if remote is not None:
            _torbox_sources[job_id] = source  # players start from TorBox while ViKiNG imports
            try:
                await _import_remote(engine, job_id, pending, remote, name_for, folder, note=note)
            finally:
                _torbox_sources.pop(job_id, None)
        else:
            await _transfer(engine, job_id, pending, source, sink, work_dir, name_for, folder, note=note)
            if maps is not None and job is not None:  # this server hashed the pieces: the map now carries them
                await maps.save(folder, map_document(job, files, plan, _ready_hashes(engine, job_id)))
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


class VikingRemoteImport:
    """Remote mode: ViKiNG downloads each file from its TorBox link (a retry asks TorBox for a new link)."""

    def __init__(self, provider: TorBoxVikingProvider, source: "TorboxRangeSource"):
        self.provider, self.source = provider, source

    async def import_file(self, piece: PlannedPiece, name: str, folder: str = "", refresh: bool = False) -> str:
        link = await self.source._link(piece.file_index, refresh=refresh)
        result = await self.provider.remote_upload_to_viking(link, name, folder)
        file_hash = str(result.get("hash") or "").strip()
        if not file_hash:
            raise ProviderFailure("viking_upload_invalid_response", 502, "ViKiNG no devolvió el identificador del archivo.")
        size = int(result.get("size") or 0)
        if size and size != piece.size:
            raise RuntimeError(f"ViKiNG importó {size} bytes de {piece.size}")
        return file_hash


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

                mode = (os.getenv("GAMEACCESS_CHUNK_MODE") or DEFAULT_MODE).strip().lower()
                importer = (lambda source: VikingRemoteImport(worker, source)) if mode == "remote" else None
                await run_chunk_job(engine, job_id, prepare=prepare, sink=VikingFileSink(worker), work_dir=work_dir or default_work_dir(),
                                    installation_id=installation_id, skip=skip, importer=importer,
                                    maps=VikingMapStore(worker))

    task = asyncio.create_task(runner())
    _running[job_id] = task
    task.add_done_callback(lambda _t: _running.pop(job_id, None))
    return task
