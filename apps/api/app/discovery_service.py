"""Central discovery maintenance and immutable client update packages.
No crawl runs inside a catalog request or on the desktop.
"""
from __future__ import annotations
from argparse import Namespace
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

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

from .discovery_catalog import OUTPUT_DIR, refresh
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
        db = sqlite3.connect(target)
        try:
            yield db
        finally:
            db.close()


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
    """Only upserts: omitted games/details never become deletion instructions."""
    if not re.fullmatch(r"[a-f0-9]{16}", base_revision):
        raise HTTPException(404, "Catalog base revision not found")
    def rows(rev):
        db = sqlite3.connect(":memory:")
        try:
            db.deserialize(gzip.decompress(package_path(rev).read_bytes()))
            games = {app_id or gid: payload for gid, app_id, payload in
                     db.execute("SELECT id,app_id,payload FROM catalog_game")}
            details = {(gid, lang, country): payload for gid, lang, country, payload in
                       db.execute("SELECT game_id,language,country,payload FROM game_detail")}
            return games, details
        finally:
            db.close()
    previous, previous_details = rows(base_revision)
    current, current_details = rows(revision)
    app_ids = {json.loads(payload)["id"]: json.loads(payload).get("app_id") for payload in current.values()}
    batch = {"schema_version": 1, "base_revision": base_revision, "revision": revision,
             "games": [json.loads(payload) for key, payload in current.items()
                       if previous.get(key) != payload],
             "details": [{"game_id": key[0], "language": key[1], "country": key[2],
                          "app_id": app_ids.get(key[0]), "payload": json.loads(payload)}
                         for key, payload in current_details.items()
                         if previous_details.get(key) != payload]}
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


def bootstrap():
    if (current_directory() / "catalog-manifest.json").is_file():
        return
    ROOT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=45, follow_redirects=True) as client:
        response = client.get(os.environ.get("GAMEACCESS_DISCOVERY_SEED_MANIFEST", MANIFEST))
        response.raise_for_status()
        data = response.json()
        from urllib.parse import urlparse
        parsed = urlparse(data["artifact_url"])
        if parsed.scheme != "https" or parsed.hostname != "raw.githubusercontent.com":
            raise ValueError("Discovery seed must use the trusted GitHub content host")
        artifact = client.get(data["artifact_url"])
        artifact.raise_for_status()
        if hashlib.sha256(artifact.content).hexdigest() != data["sha256"]:
            raise ValueError("Discovery bootstrap hash mismatch")
        if not re.fullmatch(r"[a-f0-9]{16}", data["revision"]):
            raise ValueError("Invalid discovery revision")
        (ROOT / f"catalog-cache-{data['revision']}.sqlite.gz").write_bytes(artifact.content)
        (ROOT / "catalog-manifest.json").write_text(json.dumps(data), encoding="utf-8")


def maintain_once():
    _status.update(state="updating")
    LOG.info("Central Steam discovery refresh started")
    try:
        bootstrap()
        refresh(Namespace(seed_dir=current_directory(), output_dir=ROOT,
                          cache_dir=ROOT / "requests", as_of=None, days=365,
                          popular_limit=5000, cooptimus_limit=0, enrichment_file=None,
                          delay=1.1, github_ref="dev", keep_old=True))
        _status.update(state="ready", revision=manifest()["revision"])
        LOG.info("Central discovery package ready: revision=%s count=%s", manifest()["revision"], manifest()["catalog_count"])
    except Exception:
        _status.update(state="failed")
        LOG.exception("Central discovery update failed; last validated package retained")


def start_maintenance():
    global _worker
    # Multi-worker deployments run a single scheduled worker externally. The
    # default uvicorn deployment has one worker; disable here for test processes.
    if os.environ.get("GAMEACCESS_DISCOVERY_SYNC", "1") == "0" or _worker is not None:
        return
    _stop.clear()
    def run():
        if _stop.wait(15):
            return
        while not _stop.is_set():
            maintain_once()
            if _stop.wait(max(3600, int(os.environ.get("GAMEACCESS_DISCOVERY_INTERVAL_SECONDS", "86400")))):
                break
    _worker = threading.Thread(target=run, daemon=True, name="steam-discovery-maintenance")
    _worker.start()


def stop_maintenance():
    _stop.set()
