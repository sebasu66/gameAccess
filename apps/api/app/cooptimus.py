"""On-demand public cooperative details; never overwrites Steam metadata."""
from __future__ import annotations
import html
import json
import logging
import re
import threading
import time
from pathlib import Path
import httpx
from fastapi import APIRouter, HTTPException
from .discovery_catalog import cooptimus_features
router = APIRouter()
CACHE = Path(__file__).resolve().parents[1] / ".cache/cooptimus"
LOG = logging.getLogger("gameaccess.cooptimus")
_lock = threading.Lock()
SEARCH = "https://www.co-optimus.com/ajax/ajax_games.php"

def public_features(raw, app_id):
    # Public game page identity is its Steam store link, not the page's title.
    if not re.search(r"https?://store\.steampowered\.com/app/" + str(app_id) + r"(?:/|[?\"'])", html.unescape(raw)):
        return cooptimus_features(raw, app_id)
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", raw)))
    data = {}
    for label, key in (("Local Co-Op","local_players_max"),("Online Co-Op","online_players_max"),
                       ("LAN Play or System Link","lan_players_max"),("Combo Co-Op (Local + Online)","combo_players_max")):
        match = re.search(re.escape(label) + r"\s*(?:(\d+) Players?|Not Supported)", text, re.I)
        if match:
            data[key] = int(match[1]) if match[1] else 0
    if not data:
        return None
    for label, key in (("Co-Op Campaign","coop_campaign"),("Co-Op Modes","coop_modes"),("Splitscreen","shared_split_screen")):
        data[key] = label in text
    return data

def candidate_urls(raw):
    return list(dict.fromkeys("https://www.co-optimus.com" + path for path in re.findall(r"(?:https?://www\.co-optimus\.com)?(/game/\d+/pc/[^\"'<>\s]+)", html.unescape(raw))))[:3]

def detail_metadata(app_id: int, client=None, cache_dir: Path = CACHE, name="", refresh=False) -> dict:
    if not 0 < app_id <= 2147483647:
        raise HTTPException(422, "Invalid Steam AppID")
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{app_id}.json"
    previous = None
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
        ttl = 7 * 86400 if previous["data"].get("state") == "ready" else 60
        if not refresh and time.time() - previous["cached_at"] < ttl:
            return previous["data"]
    except (KeyError, OSError, ValueError):
        pass
    data = {"app_id":app_id,"source":"co-optimus","state":"unavailable",
            "source_url":"https://www.co-optimus.com/games.php?system=4&game-title-filter=" + str(httpx.QueryParams({"q":name}))[2:]}
    LOG.info("Co-Optimus detail lookup started: AppID=%s", app_id)
    own = client is None
    transport = client or httpx.Client(timeout=5,follow_redirects=True,headers={"User-Agent":"GameAccess/1.0 public game detail"})
    try:
        response = transport.get(SEARCH,params={"game-title-filter":name,"system":4,"playerCount":2,"countDirection":"at least"})
        response.raise_for_status()
        features = cooptimus_features(response.text, app_id) # compatible with a verified XML feed
        if features:
            data.update(features,state="ready")
        else:
            data["state"]="unverified"
            for url in candidate_urls(response.text):
                page = transport.get(url)
                page.raise_for_status()
                features = public_features(page.text, app_id)
                if features:
                    data.update(features,state="ready",source_url=url)
                    break
    except httpx.HTTPError as exc:
        data["state"]="unavailable"
        LOG.warning("Co-Optimus lookup failed: AppID=%s error=%s", app_id,type(exc).__name__)
    finally:
        if own:
            transport.close()
    if data["state"]!="ready" and previous and previous.get("data",{}).get("state")=="ready":
        data = {**previous["data"],"stale":True}
    with _lock:
        temp = path.with_suffix(".next")
        temp.write_text(json.dumps({"cached_at":time.time(),"data":data}),encoding="utf-8")
        temp.replace(path)
    LOG.info("Co-Optimus detail result: AppID=%s state=%s",app_id,data["state"])
    return data

@router.get("/library/games/{app_id}/cooptimus")
def cooptimus_details(app_id:int,name:str="",refresh:bool=False):
    return detail_metadata(app_id,name=name[:300],refresh=refresh)
