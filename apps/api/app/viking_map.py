"""The map of a source on ViKiNG (its files and where each piece sits), kept in ViKiNG itself.

The server keeps its jobs in `viking_local.db`, out of the shared database on purpose (every download in
progress writes to it, and the shared pool locks up). But Render wipes that disk on every deploy or restart,
and with it every map: the next player of a game ViKiNG already holds would start from TorBox again and
ViKiNG would import it a second time.

So each source has its own ViKiNG folder, named after its fingerprint, holding its pieces and one small
`ga-map.json` with the file list and the plan. A server that does not know a source lists that folder: the
map gives the files and the pieces, the listing tells which pieces ViKiNG already holds (hash and size).
Nothing of it reaches the shared database, and the original link is never written to ViKiNG.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol

from sqlalchemy.engine import Engine
from sqlmodel import Session

from .download_events import log_event
from .viking_cache_service import ProviderFailure, TorBoxVikingProvider, create_provider
from .viking_chunk_models import VikingChunkJob, VikingChunkPiece
from .viking_chunk_plan import PlannedPiece

logger = logging.getLogger("gameaccess.viking_map")

MAP_NAME = "ga-map.json"
MAP_VERSION = 1
PIECE_NAME = re.compile(r"\.p(\d{4,})$")
ABSENT_SECONDS = 3600.0  # a folder found empty is not listed again for a while (only this server fills it)


def folder_for(fingerprint: str) -> str:
    return f"GameAccess/{fingerprint[:16]}"


def piece_name(fingerprint: str, index: int) -> str:
    return f"ga-{fingerprint[:8]}.p{index:04d}"


def map_document(job: VikingChunkJob, files: list[dict[str, Any]], plan: Iterable[PlannedPiece],
                 sha256: dict[int, str] | None = None) -> dict[str, Any]:
    sha256 = sha256 or {}
    return {
        "v": MAP_VERSION,
        "kind": job.source_kind,
        "item_name": job.item_name,
        "files": [{"index": i, "name": f["name"], "size": int(f["size"])} for i, f in enumerate(files)],
        "pieces": [
            {"index": p.index, "file_index": p.file_index, "start": p.start, "size": p.size, "sha256": sha256.get(p.index, "")}
            for p in plan
        ],
    }


class MapStore(Protocol):
    async def save(self, folder: str, document: dict[str, Any]) -> None: ...
    async def load(self, folder: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]: ...


class VikingMapStore:
    def __init__(self, provider: TorBoxVikingProvider):
        self.provider = provider

    async def save(self, folder: str, document: dict[str, Any]) -> None:
        """Upload the map, then remove the older maps of the folder. A failure only costs a re-import later."""
        try:
            with tempfile.TemporaryDirectory(prefix="gameaccess-map-") as work:
                path = Path(work) / MAP_NAME
                path.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
                result = await self.provider.upload_file_to_viking(path, MAP_NAME, folder)
            new_hash = str(result.get("hash") or "")
            for entry in await self.provider.list_viking_folder(folder):
                if entry["name"] == MAP_NAME and new_hash and entry["hash"] != new_hash:
                    await self.provider.delete_viking_file(entry["hash"])
        except (ProviderFailure, OSError) as exc:
            logger.warning("viking_map_save_failed folder=%s error=%s", folder, getattr(exc, "code", type(exc).__name__))

    async def load(self, folder: str) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        listing = await self.provider.list_viking_folder(folder)
        maps = sorted((e for e in listing if e["name"] == MAP_NAME), key=lambda e: e["created"])
        if not maps:
            return None, listing
        try:
            document = json.loads(await self.provider.read_viking_file(maps[-1]["hash"]))
        except ValueError:
            return None, listing
        return document, listing


def _valid(document: Any) -> bool:
    if not isinstance(document, dict) or document.get("v") != MAP_VERSION:
        return False
    files, pieces = document.get("files"), document.get("pieces")
    if not isinstance(files, list) or not isinstance(pieces, list) or not pieces:
        return False
    try:
        return all(int(p["file_index"]) < len(files) and int(p["size"]) > 0 and int(p["start"]) >= 0 for p in pieces)
    except (KeyError, TypeError, ValueError):
        return False


def install_restored_job(engine: Engine, fingerprint: str, document: dict[str, Any], listing: list[dict[str, Any]],
                         *, source_url: str = "") -> str | None:
    """Create the local job and pieces from a ViKiNG map; return its job id, or None for an unusable map.

    A piece is ready when ViKiNG holds a file of its name and size (and, for a piece this server hashed, the
    map has its hash). The job is "ready" when every piece is; otherwise it is left "failed" so the next
    request resumes it and only the missing pieces are imported."""
    from .viking_chunk_service import create_job, _now, _touch  # the service imports this module

    if not _valid(document):
        return None
    held: dict[int, list[dict[str, Any]]] = {}
    for entry in listing:
        match = PIECE_NAME.search(entry["name"])
        if match:
            held.setdefault(int(match.group(1)), []).append(entry)
    with Session(engine) as session:
        job = create_job(session, fingerprint=fingerprint, kind=str(document.get("kind") or ""),
                         item_name=str(document.get("item_name") or "")[:300], source_url=source_url)
        now, ready = _now(), 0
        for p in document["pieces"]:
            index, size, sha = int(p["index"]), int(p["size"]), str(p.get("sha256") or "")
            copies = [e for e in held.get(index, []) if e["size"] == size]
            # A piece this server split itself needs its hash; a whole file ViKiNG imported never had one.
            whole_file = int(p["start"]) == 0 and size == int(document["files"][int(p["file_index"])]["size"])
            viking_hash = max(copies, key=lambda e: e["created"])["hash"] if copies and (sha or whole_file) else None
            ready += viking_hash is not None
            session.add(VikingChunkPiece(
                job_id=job.job_id, piece_index=index, file_index=int(p["file_index"]), start_byte=int(p["start"]),
                size_bytes=size, sha256=sha if viking_hash else "", viking_hash=viking_hash,
                status="ready" if viking_hash else "pending", updated_at=now,
            ))
        files = document["files"]
        job.files_json = json.dumps([{"index": i, "name": f["name"], "size": int(f["size"])} for i, f in enumerate(files)])
        job.total_bytes = sum(int(f["size"]) for f in files)
        complete = ready == len(document["pieces"])
        job.status, job.error_code = ("ready", "") if complete else ("failed", "restored_incomplete")
        job.owner = ""
        if complete:
            job.completed_at = now
        _touch(job)
        session.add(job)
        session.commit()
        job_id = job.job_id
    logger.info("viking_map_restored job=%s pieces=%s ready=%s", job_id[:8], len(document["pieces"]), ready)
    log_event(engine, job_id, "restore",
              f"El servidor no recordaba «{document.get('item_name') or 'este juego'}»: recuperó su mapa de Viking "
              f"({ready} de {len(document['pieces'])} piezas ya estaban ahí).", status="ok")
    return job_id


_locks: dict[str, asyncio.Lock] = {}
_absent: dict[str, float] = {}


async def restore_from_viking(engine: Engine, fingerprint: str, *, source_url: str = "",
                              store_factory: Callable[[], MapStore] | None = None) -> str | None:
    """The job id of a source this server forgot (a redeploy), rebuilt from its ViKiNG folder, or None.

    One lookup per source at a time; an empty folder is remembered for a while so new games cost one listing."""
    from .viking_chunk_service import find_job_for_source  # the service imports this module

    seen = _absent.get(fingerprint)
    if seen is not None and time.monotonic() - seen < ABSENT_SECONDS:
        return None
    lock = _locks.setdefault(fingerprint, asyncio.Lock())
    async with lock:
        with Session(engine) as session:
            job = find_job_for_source(session, fingerprint)
            if job is not None:  # another request restored it (or started it) meanwhile
                return job.job_id
        store = (store_factory or (lambda: VikingMapStore(create_provider())))()
        try:
            document, listing = await store.load(folder_for(fingerprint))
        except ProviderFailure as exc:
            logger.warning("viking_map_load_failed fingerprint=%s error=%s", fingerprint[:12], exc.code)
            return None  # ViKiNG did not answer: the source starts as new, without remembering it as absent
        job_id = install_restored_job(engine, fingerprint, document, listing, source_url=source_url) if document else None
        if job_id is None:
            _absent[fingerprint] = time.monotonic()
        return job_id
