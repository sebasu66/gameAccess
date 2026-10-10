"""Central discovery maintenance and immutable client update packages.
No crawl runs inside a catalog request or on the desktop.
"""
from __future__ import annotations
from argparse import Namespace
import gzip
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import threading

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

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
_cached_games = []
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


def catalog_games() -> list[dict]:
    global _cached_revision, _cached_games
    try:
        info = manifest()
    except HTTPException:
        return []
    with _lock:
        if info["revision"] == _cached_revision:
            return _cached_games
        compressed = package_path(info["revision"]).read_bytes()
        if hashlib.sha256(compressed).hexdigest() != info["sha256"]:
            LOG.error("Central catalog package hash mismatch")
            return _cached_games
        db = sqlite3.connect(":memory:")
        try:
            db.deserialize(gzip.decompress(compressed))
            games = []
            for (payload,) in db.execute("SELECT payload FROM catalog_game ORDER BY id"):
                game = json.loads(payload)
                game["id"] = game["app_id"] or game["id"]
                games.append(game)
        finally:
            db.close()
        _cached_revision, _cached_games = info["revision"], games
        return games


@router.get("/library/catalog/manifest", name="discovery_manifest")
def client_manifest(request: Request):
    data = manifest()
    return {**data, "artifact_url": str(request.url_for("discovery_package", revision=data["revision"]))}


@router.get("/library/catalog/packages/{revision}", name="discovery_package")
def client_package(revision: str):
    return FileResponse(package_path(revision), media_type="application/gzip",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


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
