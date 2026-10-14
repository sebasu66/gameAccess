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
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol
from uuid import uuid4

import httpx
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from .viking_cache_service import ProviderFailure, TorBoxVikingProvider, TorboxItem, create_provider
from .viking_chunk_models import VikingChunkJob, VikingChunkPiece
from .viking_chunk_plan import PlannedPiece, plan_pieces

logger = logging.getLogger("gameaccess.viking_chunks")

MAX_FILES = 200            # a source with more files than this is not worth splitting
PIECE_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 3.0
MAX_PIECES_ON_DISK = 2
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

def _touch(job: VikingChunkJob) -> None:
    job.updated_at = _now()


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
        item_name=item_name[:300], status="preparing", created_at=now, updated_at=now,
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


def recover_interrupted_chunk_jobs(engine: Engine) -> int:
    """After a restart nothing is working on a job the database calls active; fail it so it can resume."""
    with Session(engine) as session:
        jobs = session.exec(select(VikingChunkJob).where(VikingChunkJob.status.in_(("preparing", "running")))).all()
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
    work_dir: Path, name_for: Callable[[PlannedPiece], str], folder: str = "",
) -> None:
    """Fetch piece N+1 while piece N uploads, with at most MAX_PIECES_ON_DISK files on disk."""
    slots = asyncio.Semaphore(MAX_PIECES_ON_DISK)
    queue: asyncio.Queue = asyncio.Queue()

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
            finally:
                path.unlink(missing_ok=True)
                slots.release()

    tasks = [asyncio.create_task(producer()), asyncio.create_task(consumer())]
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
    sink: PieceSink, work_dir: Path,
) -> None:
    """Prepare the source, plan the pieces and move every missing one to ViKiNG."""
    source: Any = None
    try:
        work_dir.mkdir(parents=True, exist_ok=True)
        source, files = await prepare()
        if len(files) > MAX_FILES:
            raise ProviderFailure("too_many_files", 422, "Esta fuente tiene demasiados archivos para enviarla por piezas.")
        plan = plan_pieces([int(f["size"]) for f in files])
        if not plan:
            raise ProviderFailure("torbox_no_files", 502, "TorBox no informó los archivos de esta fuente.")
        ready = _install_plan(engine, job_id, files, plan)
        _set_job(engine, job_id, status="running", error_code="")
        pending = [p for p in plan if p.index not in ready]
        logger.info("chunk_job_running job=%s pieces=%s pending=%s", job_id[:8], len(plan), len(pending))
        await _transfer(
            engine, job_id, pending, source, sink, work_dir,
            lambda p: f"ga-{job_id[:8]}.p{p.index:04d}", viking_folder(job_id),
        )
        _set_job(engine, job_id, status="ready", completed_at=_now())
        logger.info("chunk_job_ready job=%s", job_id[:8])
    except asyncio.CancelledError:
        _fail_job(engine, job_id, "server_stopped")
        raise
    except ProviderFailure as exc:
        logger.error("chunk_job_failed job=%s code=%s", job_id[:8], exc.code)
        _fail_job(engine, job_id, exc.code)
    except Exception:  # noqa: BLE001 - the job row must always leave "running"
        logger.exception("chunk_job_crashed job=%s", job_id[:8])
        _fail_job(engine, job_id, "unexpected_error")
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
                async def prepare() -> tuple[PieceSource, list[dict[str, Any]]]:
                    item, files = await worker.prepare_chunk_source(
                        api_client, source_url=source_url, source_kind=source_kind, source_host=source_host,
                        file_name=file_name, request_id=job_id, installation_id=installation_id, fingerprint=fingerprint,
                    )
                    return TorboxRangeSource(worker, api_client, item, files), files

                await run_chunk_job(engine, job_id, prepare=prepare, sink=VikingFileSink(worker), work_dir=work_dir or default_work_dir())

    task = asyncio.create_task(runner())
    _running[job_id] = task
    task.add_done_callback(lambda _t: _running.pop(job_id, None))
    return task
