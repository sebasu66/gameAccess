"""Optional detail enrichment, fetched only after a client opens one game."""
from __future__ import annotations
import json
import logging
from pathlib import Path
import threading
import time
import httpx
from fastapi import APIRouter, HTTPException
from .discovery_catalog import COOPTIMUS, cooptimus_features

router = APIRouter()
CACHE = Path(__file__).resolve().parents[1] / ".cache/cooptimus"
_lock = threading.Lock()
LOG = logging.getLogger("gameaccess.cooptimus")


def detail_metadata(app_id: int, client=None, cache_dir: Path = CACHE) -> dict:
    if not 0 < app_id <= 2147483647:
        raise HTTPException(422, "Invalid Steam AppID")
    with _lock:
        cache_dir.mkdir(parents=True, exist_ok=True)
        path = cache_dir / f"{app_id}.json"
        if path.exists():
            try:
                cached = json.loads(path.read_text(encoding="utf-8"))
                ttl = 7 * 86400 if cached["data"].get("state") == "ready" else 3600
                if time.time() - cached["cached_at"] < ttl:
                    return cached["data"]
            except (KeyError, OSError, ValueError):
                pass
        LOG.info("Co-Optimus detail request: steam_app_id=%s", app_id)
        data = {"app_id": app_id, "source": "co-optimus", "state": "unavailable",
                "source_url": f"https://www.co-optimus.com/games.php?search=true&steam={app_id}"}
        try:
            if client is None:
                with httpx.Client(timeout=5, follow_redirects=True, headers={"User-Agent":"GameAccess/1.0 game detail metadata"}) as transport:
                    response = transport.get(COOPTIMUS, params={"search":"true", "steam":app_id})
            else:
                response = client.get(COOPTIMUS, params={"search":"true", "steam":app_id})
            response.raise_for_status()
            features = cooptimus_features(response.text, app_id)
            if features:
                data.update(features, state="ready")
            else:
                data["state"] = "unverified"
        except httpx.HTTPError as exc:
            LOG.warning("Co-Optimus detail lookup unavailable: steam_app_id=%s error=%s", app_id, type(exc).__name__)
        # Failure results use a short TTL. They never erase a Steam field or a
        # previously verified record; stale verified data remains useful offline.
        if data["state"] != "ready" and path.exists():
            try:
                previous = json.loads(path.read_text(encoding="utf-8"))
                if previous["data"].get("state") == "ready":
                    data = {**previous["data"], "stale": True}
            except (KeyError, OSError, ValueError):
                pass
        temp = path.with_suffix(".next")
        temp.write_text(json.dumps({"cached_at":time.time(), "data":data}), encoding="utf-8")
        temp.replace(path)
        LOG.info("Co-Optimus detail result: steam_app_id=%s state=%s", app_id, data["state"])
        return data


@router.get("/library/games/{app_id}/cooptimus")
def cooptimus_details(app_id: int):
    return detail_metadata(app_id)
