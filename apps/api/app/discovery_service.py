"""Central discovery maintenance and immutable client update packages.
No crawl runs inside a catalog request or on the desktop.
"""
from __future__ import annotations
from contextlib import contextmanager
from functools import lru_cache
import gzip
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import threading
import time

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

from .discovery_catalog import OUTPUT_DIR
from .catalog_snapshot import stable_json

LOG = logging.getLogger("gameaccess.discovery")
ROOT = Path(os.environ.get("GAMEACCESS_DISCOVERY_DIR", str(Path(__file__).resolve().parents[1] / ".cache/discovery-catalog")))
MANIFEST = "https://raw.githubusercontent.com/sebasu66/gameAccess/refs/heads/dev/deploy/catalog-cache/catalog-manifest.json"
router = APIRouter()
_stop = threading.Event()
_worker = None
_lock = threading.Lock()
_cached_revision = ""
_cached_identities: list[int] = []   # Steam ids only: the 42k game payloads are never kept in memory (they cost ~285 MB)
_cached_inventory = ""
_status = {"state": "idle"}


def current_directory() -> Path:
    return ROOT if (ROOT / "catalog-manifest.json").is_file() else OUTPUT_DIR


def manifest() -> dict:
    try:
        return json.loads((current_directory() / "catalog-manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "Discovery database is not available yet") from exc


def package_path(revision: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{16}", revision):
        raise HTTPException(404, "Catalog revision not found")
    for directory in (ROOT, OUTPUT_DIR):
        candidate = directory / f"catalog-cache-{revision}.sqlite.gz"
        if candidate.is_file():
            return candidate
    raise HTTPException(404, "Catalog revision not found")


@contextmanager
def snapshot_db(revision: str, expected_sha256: str = ""):
    """The central package as a SQLite file on disk: it is unzipped to a temp file and read row by row.

    Never `deserialize` it into memory: that holds the whole database (~75 MB) plus a copy while loading, which
    is what used to push the 512 MB server over its limit together with the parsed games."""
    with unpacked_package(revision, expected_sha256) as target:
        db = sqlite3.connect(target)
        try:
            yield db
        finally:
            db.close()


@contextmanager
def unpacked_package(revision: str, expected_sha256: str = ""):
    """The package unzipped to a temporary SQLite file (removed afterwards)."""
    source = package_path(revision)
    if expected_sha256:
        digest = hashlib.sha256()
        with source.open("rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        if digest.hexdigest() != expected_sha256:
            LOG.error("Central catalog package hash mismatch")
            raise HTTPException(503, "Catalog package failed verification")
    with tempfile.TemporaryDirectory(prefix="ga-catalog-") as directory:
        target = Path(directory) / "catalog.sqlite"
        with gzip.open(source, "rb") as packed, target.open("wb") as unpacked:
            shutil.copyfileobj(packed, unpacked, 1 << 20)
        yield target


def iter_catalog_games():
    """Catalog games one at a time (Steam id exposed as `id`), without ever holding the whole catalog."""
    try:
        info = manifest()
        with snapshot_db(info["revision"], info["sha256"]) as db:
            for (payload,) in db.execute("SELECT payload FROM catalog_game ORDER BY id"):
                game = json.loads(payload)
                game["id"] = game["app_id"] or game["id"]
                yield game
    except HTTPException:
        return


def catalog_identities() -> tuple[list[int], str]:
    """Sorted Steam ids and their inventory hash, computed once per revision (a list of ints, not of games)."""
    global _cached_revision, _cached_identities, _cached_inventory
    try:
        info = manifest()
    except HTTPException:
        return [], ""
    with _lock:
        if info["revision"] != _cached_revision:
            identities = sorted(game["app_id"] or game["id"] for game in iter_catalog_games())
            if identities:
                _cached_revision, _cached_identities = info["revision"], identities
                _cached_inventory = hashlib.sha256(stable_json(identities).encode()).hexdigest()
        return _cached_identities, _cached_inventory


def catalog_games() -> list[dict]:
    """Every game as a list. Materializes the catalog: for tests and tools, never for request handlers."""
    return list(iter_catalog_games())


@lru_cache(maxsize=32)
def update_batch(base_revision: str, revision: str) -> bytes:
    """Only upserts: omitted games/details never become deletion instructions.

    Both packages are compared on disk with SQL, so only the new and changed rows are ever loaded (loading
    both catalogs into memory took several hundred MB and could take the 512 MB server down)."""
    if not re.fullmatch(r"[a-f0-9]{16}", base_revision):
        raise HTTPException(404, "Catalog base revision not found")
    with unpacked_package(base_revision) as previous, unpacked_package(revision) as current:
        db = sqlite3.connect(current)
        try:
            db.execute("ATTACH DATABASE ? AS prev", (str(previous),))
            # The unpacked copy is ours: index the game identity so the comparison is a lookup per game, not a scan.
            db.execute("CREATE INDEX IF NOT EXISTS prev.ix_ga_identity ON catalog_game(coalesce(nullif(app_id, 0), id))")
            key = "coalesce(nullif({t}.app_id, 0), {t}.id)"
            games = [json.loads(payload) for (payload,) in db.execute(
                f"SELECT c.payload FROM main.catalog_game c LEFT JOIN prev.catalog_game p "
                f"ON {key.format(t='p')} = {key.format(t='c')} WHERE p.payload IS NOT c.payload ORDER BY c.rowid")]
            details = [{"game_id": gid, "language": lang, "country": country, "app_id": app_id, "payload": json.loads(payload)}
                       for gid, lang, country, app_id, payload in db.execute(
                           "SELECT d.game_id, d.language, d.country, g.app_id, d.payload FROM main.game_detail d "
                           "LEFT JOIN prev.game_detail p ON p.game_id = d.game_id AND p.language = d.language "
                           "AND p.country = d.country LEFT JOIN main.catalog_game g ON g.id = d.game_id "
                           "WHERE p.payload IS NOT d.payload ORDER BY d.rowid")]
        finally:
            db.close()
    batch = {"schema_version": 1, "base_revision": base_revision, "revision": revision, "games": games, "details": details}
    return gzip.compress(stable_json(batch).encode("utf-8"), mtime=0)


@router.get("/library/catalog/updates/{base_revision}/{revision}", name="discovery_update")
def client_update(base_revision: str, revision: str):
    return Response(update_batch(base_revision, revision), media_type="application/gzip",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})

@router.get("/library/catalog/manifest", name="discovery_manifest")
def client_manifest(request: Request, since: str = ""):
    data = manifest()
    data["inventory_sha256"] = catalog_identities()[1]
    if since and since != data["revision"]:
        try:
            compressed = update_batch(since, data["revision"])
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            # First install or a legacy revision: the client merges the baseline,
            # preserving its existing rows and locally cached details.
        else:
            return {**data, "kind": "delta", "base_revision": since,
                    "sha256": hashlib.sha256(compressed).hexdigest(),
                    "compressed_bytes": len(compressed),
                    "artifact_url": str(request.url_for("discovery_update",
                        base_revision=since, revision=data["revision"]))}
    return {**data, "kind": "baseline",
            "artifact_url": str(request.url_for("discovery_package", revision=data["revision"]))}


@router.get("/library/catalog/packages/{revision}", name="discovery_package")
def client_package(revision: str):
    return FileResponse(package_path(revision), media_type="application/gzip",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})



@router.post("/library/catalog/reconcile")
async def reconcile_catalog(request: Request):
    """Compare exact Steam identities; return missing rows, never remove extras."""
    payload = await request.json()
    present = payload.get("present")
    base = payload.get("base_revision", "")
    if (not isinstance(present, list) or len(present) > 250000 or
            any(type(value) is not int or value <= 0 for value in present) or
            not re.fullmatch(r"[a-f0-9]{16}", base)):
        raise HTTPException(400, "Invalid catalog inventory")
    data = manifest()
    identities = set(present)
    # One pass over the package on disk; packages use stable internal IDs, the UI and the client use Steam IDs.
    with snapshot_db(data["revision"], data["sha256"]) as db:
        games = []
        for (row,) in db.execute("SELECT payload FROM catalog_game ORDER BY id"):
            game = json.loads(row)
            if (game.get("app_id") or game["id"]) not in identities:
                games.append(game)
        internal_ids = {game["id"]: game.get("app_id") for game in games}
        details = [{"game_id": gid, "app_id": internal_ids[gid], "language": lang,
                    "country": country, "payload": json.loads(row)}
                   for gid, lang, country, row in db.execute("SELECT game_id,language,country,payload FROM game_detail")
                   if gid in internal_ids]
    batch = {"schema_version": 1, "base_revision": base, "revision": data["revision"],
             "games": games, "details": details}
    compressed = gzip.compress(stable_json(batch).encode(), mtime=0)
    LOG.info("Catalog reconciliation: client=%s missing=%s revision=%s", len(identities), len(games), data["revision"])
    return Response(compressed, media_type="application/gzip",
                    headers={"X-Catalog-SHA256": hashlib.sha256(compressed).hexdigest(),
                             "Cache-Control": "no-store"})

@router.get("/library/catalog/status")
def discovery_status():
    return {**_status, "catalog": manifest()}


KEEP_PACKAGES = 3  # the current package and two older ones, so clients one or two days behind still get a delta
STATE_FILE = "sync-state.json"


def sync_published(transport: httpx.BaseTransport | None = None) -> bool:
    """Download the catalog package GitHub Actions published, when its revision is new. True when it changed.

    The server never builds the catalog itself: the daily `discovery-catalog.yml` job does (rebuilding it here
    loaded the whole catalog into memory and pushed the 512 MB server over its limit at every start). The package
    is streamed to disk and checked against the manifest's hash before it replaces the current one."""
    ROOT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=20.0), follow_redirects=True, transport=transport) as client:
        response = client.get(os.environ.get("GAMEACCESS_DISCOVERY_SEED_MANIFEST", MANIFEST))
        response.raise_for_status()
        data = response.json()
        if not re.fullmatch(r"[a-f0-9]{16}", str(data.get("revision", ""))):
            raise ValueError("Invalid discovery revision")
        from urllib.parse import urlparse
        if urlparse(data["artifact_url"]).scheme != "https" or urlparse(data["artifact_url"]).hostname != "raw.githubusercontent.com":
            raise ValueError("Discovery package must come from the trusted GitHub content host")
        current = ROOT / "catalog-manifest.json"
        try:
            if json.loads(current.read_text(encoding="utf-8")).get("revision") == data["revision"]:
                return False
        except (OSError, ValueError):
            pass
        target = ROOT / f"catalog-cache-{data['revision']}.sqlite.gz"
        partial = target.with_suffix(".part")
        digest = hashlib.sha256()
        with client.stream("GET", data["artifact_url"]) as artifact:
            artifact.raise_for_status()
            with partial.open("wb") as handle:
                for block in artifact.iter_bytes(1 << 20):
                    digest.update(block)
                    handle.write(block)
    if digest.hexdigest() != data["sha256"]:
        partial.unlink(missing_ok=True)
        raise ValueError("Discovery package hash mismatch")
    os.replace(partial, target)
    staged = current.with_suffix(".tmp")
    staged.write_text(json.dumps(data), encoding="utf-8")
    os.replace(staged, current)
    packages = sorted(ROOT.glob("catalog-cache-*.sqlite.gz"), key=lambda path: path.stat().st_mtime, reverse=True)
    for old in packages[KEEP_PACKAGES:]:
        if old != target:
            old.unlink(missing_ok=True)
    return True


def _last_sync() -> float:
    try:
        return float(json.loads((ROOT / STATE_FILE).read_text(encoding="utf-8"))["last_attempt"])
    except (OSError, ValueError, KeyError, TypeError):
        return 0.0


def _remember_sync() -> None:
    try:
        ROOT.mkdir(parents=True, exist_ok=True)
        (ROOT / STATE_FILE).write_text(json.dumps({"last_attempt": time.time()}), encoding="utf-8")
    except OSError:
        LOG.warning("Could not record the catalog sync time", exc_info=True)


def maintain_once():
    _status.update(state="updating")
    LOG.info("Catalog sync: checking the package published by GitHub")
    try:
        changed = sync_published()
        _status.update(state="ready", revision=manifest()["revision"])
        LOG.info("Catalog sync: %s revision=%s count=%s", "new package" if changed else "already current",
                 manifest()["revision"], manifest().get("catalog_count"))
    except Exception:
        _status.update(state="failed")
        LOG.exception("Catalog sync failed; last validated package retained")
    finally:
        _remember_sync()


def _interval() -> float:
    return max(3600, int(os.environ.get("GAMEACCESS_DISCOVERY_INTERVAL_SECONDS", str(6 * 3600))))


def start_maintenance():
    global _worker
    # Multi-worker deployments run a single scheduled worker externally. The
    # default uvicorn deployment has one worker; disable here for test processes.
    if os.environ.get("GAMEACCESS_DISCOVERY_SYNC", "1") == "0" or _worker is not None:
        return
    _stop.clear()
    def run():
        # A restart does not sync again if the last attempt was recent (the time is kept on disk). A server
        # without any package syncs right away.
        has_package = (ROOT / "catalog-manifest.json").is_file()
        first = max(15.0, _last_sync() + _interval() - time.time()) if has_package else 15.0
        if _stop.wait(first):
            return
        while not _stop.is_set():
            maintain_once()
            if _stop.wait(_interval()):
                break
    _worker = threading.Thread(target=run, daemon=True, name="catalog-sync")
    _worker.start()


def stop_maintenance():
    _stop.set()
