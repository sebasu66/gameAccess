from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
import time
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .digital_catalog import (
    DigitalCacheRecord,
    DigitalGame,
    DigitalSourceRecord,
    ensure_digital_source_schema,
    get_digital_catalog_path,
    load_digital_catalog_from_db,
    load_digital_catalog_json,
    sync_catalog_to_db,
    sync_digital_catalog,
)
from .steam_resolver import (
    calculate_match_score,
    clean_for_steam_lookup,
    generate_fallback_queries,
    resolve_steam_app_id,
)
from .database import engine as default_engine

logger = logging.getLogger("gameaccess.digital_admin")

router = APIRouter(prefix="/admin-console/digital", tags=["digital-admin"])

API_ROOT = Path(__file__).resolve().parent.parent
ADMIN_DIGITAL_HTML = API_ROOT / "admin" / "digital.html"
SOURCES_CONFIG_PATH = API_ROOT / "app" / "digital_sources.json"
CACHE_DIR = API_ROOT / ".cache"
CACHE_FILE = CACHE_DIR / "digital_sources_cache.json"

ROMAN_NUMERALS = {
    r"\bi\b": "1",
    r"\bii\b": "2",
    r"\biii\b": "3",
    r"\biv\b": "4",
    r"\bv\b": "5",
    r"\bvi\b": "6",
    r"\bvii\b": "7",
    r"\bviii\b": "8",
    r"\bix\b": "9",
    r"\bx\b": "10",
}

NOISE_TERMS_PATTERN = re.compile(
    r"\[(?:fitgirl|dodi|elamigos|tenoke|rune|empress|codex|skidrow|repack|flt|kaos|razor1911)[^\]]*\]|"
    r"\((?:fitgirl|dodi|elamigos|tenoke|rune|empress|codex|skidrow|repack|flt|kaos)[^)]*\)|"
    r"\b(?:repack|portable|multi\d+|x64|x86|p2p|torrent|magnet|crack|goldberg)\b",
    re.IGNORECASE
)


class GameItem(BaseModel):
    name: str = Field(min_length=1)
    id: int
    downloadSource: str = ""
    installProcess: str = ""
    playProcess: str = ""
    uninstallProcess: str = ""


class SourceItem(BaseModel):
    auto_installed: bool = False
    url: str = Field(min_length=3)
    label: str = ""
    enabled: bool = True
    priority: Optional[int] = None


class DeleteSourceRequest(BaseModel):
    url: str


class ImportSourceRequest(BaseModel):
    raw_json: Optional[str] = None
    json_data: Optional[Any] = None
    label: Optional[str] = None
    auto_add_to_catalog: bool = True


def get_sources_path() -> Path:
    if SOURCES_CONFIG_PATH.exists():
        return SOURCES_CONFIG_PATH
    # fallback
    p = API_ROOT / "digital_sources.json"
    if p.exists():
        return p
    return SOURCES_CONFIG_PATH


def load_sources_config() -> dict[str, Any]:
    path = get_sources_path()
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    sources = data.get("sources", [])
                    if sources:
                        for idx, s in enumerate(sources):
                            if isinstance(s, dict):
                                s.setdefault("auto_installed", False)
                            if isinstance(s, dict) and "priority" not in s:
                                s["priority"] = idx + 1
                        return data
        except Exception as e:
            logger.warning("Error reading digital_sources.json: %s", e)

    # Fallback to persistent database if disk file is missing or has no sources (e.g. after fresh deploy)
    try:
        ensure_digital_source_schema(default_engine)
        with Session(default_engine) as session:
            db_sources = session.exec(select(DigitalSourceRecord)).all()
            if db_sources:
                sources_dir = API_ROOT / "data" / "sources"
                sources_dir.mkdir(parents=True, exist_ok=True)
                sources_list = []
                for s in db_sources:
                    target_url = s.url
                    if s.raw_content:
                        file_name = Path(s.url).name
                        if not file_name.endswith(".json"):
                            file_name = f"source_{s.id or 1}.json"
                        local_file = sources_dir / file_name
                        if not local_file.exists():
                            try:
                                with local_file.open("w", encoding="utf-8") as f:
                                    f.write(s.raw_content)
                            except Exception:
                                pass
                        target_url = str(local_file)

                    sources_list.append({
                        "url": target_url,
                        "label": s.label,
                        "enabled": s.enabled,
                        "priority": s.priority,
                        "type": s.source_type,
                        "auto_installed": s.auto_installed,
                        "items_count": s.items_count,
                        "added_at": s.added_at,
                    })

                sources_list.sort(key=lambda x: x.get("priority", 999))
                # Restore to disk
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("w", encoding="utf-8") as f:
                    json.dump({"sources": sources_list}, f, indent=2, ensure_ascii=False)
                return {"sources": sources_list}
    except Exception as e:
        logger.warning("Error querying sources from database: %s", e)

    return {"sources": []}


def save_sources_config(data: dict[str, Any]) -> None:
    path = get_sources_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    # Clean disk copy (avoid writing huge raw_content into digital_sources.json)
    disk_sources = []
    for s in data.get("sources", []):
        if isinstance(s, dict):
            s.setdefault("auto_installed", False)
            item = {k: v for k, v in s.items() if k != "raw_content"}
            disk_sources.append(item)
    with path.open("w", encoding="utf-8") as f:
        json.dump({"sources": disk_sources}, f, indent=2, ensure_ascii=False)

    # Sync to persistent database
    try:
        ensure_digital_source_schema(default_engine)
        with Session(default_engine) as session:
            existing_records = {s.url: s for s in session.exec(select(DigitalSourceRecord)).all()}
            current_urls = set()
            now = datetime.now(timezone.utc).isoformat()
            for s in data.get("sources", []):
                if not isinstance(s, dict):
                    continue
                url = s.get("url")
                if not url:
                    continue
                current_urls.add(url)
                rec = existing_records.get(url)
                raw_c = s.get("raw_content")
                if rec:
                    rec.label = s.get("label", rec.label)
                    rec.enabled = bool(s.get("enabled", rec.enabled))
                    rec.auto_installed = bool(s.get("auto_installed", False))
                    rec.priority = int(s.get("priority", rec.priority or 1))
                    rec.items_count = int(s.get("items_count", rec.items_count or 0))
                    rec.updated_at = now
                    if raw_c:
                        rec.raw_content = raw_c
                    session.add(rec)
                else:
                    new_rec = DigitalSourceRecord(
                        url=url,
                        label=str(s.get("label", "")),
                        enabled=bool(s.get("enabled", True)),
                        priority=int(s.get("priority", 1)),
                        source_type=str(s.get("type", "hydra_source")),
                        auto_installed=bool(s.get("auto_installed", False)),
                        items_count=int(s.get("items_count", 0)),
                        added_at=str(s.get("added_at", now)),
                        updated_at=now,
                        raw_content=raw_c,
                    )
                    session.add(new_rec)

            for old_url, old_rec in existing_records.items():
                if old_url not in current_urls:
                    session.delete(old_rec)

            session.commit()
    except Exception as e:
        logger.warning("Could not sync sources to database: %s", e)


def save_catalog_json(items: list[dict[str, Any]]) -> None:
    path = get_digital_catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)

    # Sync to persistent database
    sync_catalog_to_db(items, default_engine)


def normalize_title(title: str) -> str:
    if not title:
        return ""
    text = title.lower()
    text = re.sub(r"\[.*?\]", " ", text)
    text = re.sub(r"\bv\.?[\d._]+\b", " ", text)
    text = re.sub(r"\b\d+(?:\.\d+)+[\w._-]*\b", " ", text)
    text = re.sub(r"\b(?:build|update|patch|release|rev|ver|version|hotfix)[\s._\-]*[\d._]+\b", " ", text)
    text = text.replace("&", " and ").replace("+", " and ")
    for roman, arabic in ROMAN_NUMERALS.items():
        text = re.sub(roman, arabic, text)
    text = re.sub(r"[:\-_,.'\"!/?(){}]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def clean_user_friendly_title(raw_title: str) -> str:
    cleaned = NOISE_TERMS_PATTERN.sub("", raw_title)
    cleaned = re.sub(r"\bv\.?[\d._]+\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d+(?:\.\d+)+[\w._-]*\b", "", cleaned)
    cleaned = re.sub(r"\b(?:build|update|patch|release|rev|ver|version|hotfix)[\s._\-]*[\d._]+\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[\(\[]\s*(?:19\d\d|20\d\d)\s*[\)\]]", "", cleaned)
    cleaned = re.sub(r"[\(\[\{]\s*[\)\]\}]", "", cleaned)
    cleaned = re.sub(r"[-–—]+\s*$", "", cleaned)
    cleaned = re.sub(r"^\s*[-–—]+", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()

    features = []
    if re.search(r"\b(?:all\s+dlcs?|all\s+dlc|dlcs?)\b", raw_title, re.IGNORECASE):
        features.append("Incluye expansiones")
    if re.search(r"\b(?:deluxe|goty|complete|ultimate|gold|definitive)\b", raw_title, re.IGNORECASE):
        features.append("Edición Completa")

    if features and not any(f.lower() in cleaned.lower() for f in features):
        cleaned = f"{cleaned} ({', '.join(features)})"

    return cleaned or raw_title


def extract_version_tuple(title: str) -> tuple[int, ...]:
    """Extracts numeric version / build components from a title string.
    Returns a tuple of integers, e.g. (2, 13) or (1, 0, 0, 13772).
    """
    if not title:
        return ()

    # Look for tags like: v1.2.3, ver 1.2, version 1.2.3, build 123456, update 5, patch 3, rev 120
    tag_match = re.search(r"\b(?:v|ver|version|build|update|patch|release|rev)[\s._\-]*(\d+(?:[\._]\d+)*)\b", title, re.IGNORECASE)
    if tag_match:
        raw_v = tag_match.group(1).replace("_", ".")
        parts = [int(p) for p in raw_v.split(".") if p.isdigit()]
        if parts:
            return tuple(parts)

    # Standalone semantic/dotted version like 1.0.0.13772, 0.72.0.10499, 1.10.31.0, 2.1
    sem_match = re.search(r"\b(\d+(?:\.\d+)+)\b", title)
    if sem_match:
        parts = [int(p) for p in sem_match.group(1).split(".") if p.isdigit()]
        if parts:
            return tuple(parts)

    return ()


def parse_date_timestamp(date_str: str) -> float:
    """Parses date string to unix timestamp float."""
    if not date_str:
        return 0.0
    cleaned = date_str.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(cleaned).timestamp()
    except Exception:
        pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(cleaned, fmt).replace(tzinfo=timezone.utc).timestamp()
        except Exception:
            pass
    return 0.0


def rank_download_candidate(
    item: dict[str, Any],
    priority_map: dict[str, int],
) -> tuple[int, tuple[int, ...], float]:
    """Returns a sorting key for a download candidate:
    (source_priority, padded_negated_version, -upload_timestamp).
    Smaller tuple means better ranking!

    1. Source priority: lower number = higher user preference (e.g. 1 is preferred over 2).
    2. Version tuple: highest version number wins.
    3. Upload date: most recent upload date wins.
    """
    # 1. Source Priority: lower number = higher user preference
    p = item.get("source_priority")
    if p is None:
        source_key = str(item.get("source_url") or item.get("source") or "")
        p = priority_map.get(source_key, priority_map.get(str(item.get("source") or ""), 999))

    # 2. Version: highest version number wins
    ver = extract_version_tuple(item.get("raw_title", ""))
    if ver:
        padded = tuple(list(ver) + [0] * max(0, 8 - len(ver)))
        neg_ver = tuple(-x for x in padded[:8])
    else:
        neg_ver = tuple(1 for _ in range(8))

    # 3. Date: most recent upload date wins
    date_ts = parse_date_timestamp(item.get("upload_date", ""))

    return (int(p), neg_ver, -date_ts)


def deduplicate_download_items(
    items: list[dict[str, Any]],
    sources_config: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Groups downloads of the same game together and retains ONLY the single best release:
    - Prioritizing by configured source priority (user preference).
    - In case of tie, choosing the highest version number.
    - In case of tie, choosing the most recent upload date.
    All older versions or lower-priority duplicates are discarded.
    """
    if not items:
        return []

    cfg = sources_config or load_sources_config()
    sources_list = cfg.get("sources", [])
    priority_map: dict[str, int] = {}
    for idx, s in enumerate(sources_list):
        p = s.get("priority")
        if p is None:
            p = idx + 1
        if s.get("url"):
            priority_map[s["url"]] = p
        if s.get("label"):
            priority_map[s["label"]] = p

    # Group items by canonical game identity
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        raw_title = item.get("raw_title") or item.get("title") or ""
        clean_title = item.get("clean_title") or clean_user_friendly_title(raw_title)

        norm_key = normalize_title(clean_title)
        if not norm_key:
            norm_key = normalize_title(raw_title)
        if not norm_key:
            continue

        grouped.setdefault(norm_key, []).append(item)

    # For each group, sort and pick the top 1
    best_items: list[dict[str, Any]] = []
    for norm_key, candidates in grouped.items():
        candidates.sort(key=lambda it: rank_download_candidate(it, priority_map))
        best_choice = candidates[0]
        best_choice["clean_title"] = clean_user_friendly_title(best_choice.get("raw_title") or best_choice.get("clean_title", ""))
        best_items.append(best_choice)

    return best_items


# Note: resolve_steam_app_id and calculate_match_score are provided by steam_resolver


def load_cached_downloads() -> list[dict[str, Any]]:
    if CACHE_FILE.exists() and CACHE_FILE.stat().st_size > 0:
        try:
            with CACHE_FILE.open("r", encoding="utf-8") as f:
                data = json.load(f)
                downloads = data.get("downloads", [])
                if downloads:
                    return downloads
        except Exception:
            pass

    # Fallback to persistent database if disk file is missing (e.g. after fresh deploy)
    try:
        with Session(default_engine) as session:
            cache_rec = session.exec(select(DigitalCacheRecord).where(DigitalCacheRecord.id == 1)).first()
            if cache_rec and cache_rec.payload:
                downloads = json.loads(cache_rec.payload)
                if isinstance(downloads, list):
                    # Restore cache file on disk
                    try:
                        CACHE_DIR.mkdir(parents=True, exist_ok=True)
                        with CACHE_FILE.open("w", encoding="utf-8") as f:
                            json.dump({
                                "updated_at": cache_rec.updated_at or datetime.now(timezone.utc).isoformat(),
                                "total_items": len(downloads),
                                "downloads": downloads,
                            }, f, ensure_ascii=False)
                    except Exception:
                        pass
                    return downloads
    except Exception as e:
        logger.warning("Error querying cached downloads from database: %s", e)

    return []


def save_cached_downloads(downloads: list[dict[str, Any]]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with CACHE_FILE.open("w", encoding="utf-8") as f:
        json.dump({
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "total_items": len(downloads),
            "downloads": downloads,
        }, f, ensure_ascii=False)

    # Sync to persistent database
    try:
        now = datetime.now(timezone.utc).isoformat()
        payload_str = json.dumps(downloads, ensure_ascii=False)
        with Session(default_engine) as session:
            rec = session.exec(select(DigitalCacheRecord).where(DigitalCacheRecord.id == 1)).first()
            if rec:
                rec.updated_at = now
                rec.total_items = len(downloads)
                rec.payload = payload_str
                session.add(rec)
            else:
                rec = DigitalCacheRecord(
                    id=1,
                    updated_at=now,
                    total_items=len(downloads),
                    payload=payload_str,
                )
                session.add(rec)
            session.commit()
    except Exception as e:
        logger.warning("Could not sync cached downloads to database: %s", e)


# --- WEB HTML VIEW ---
@router.get("", response_class=FileResponse)
@router.get("/", response_class=FileResponse)
def get_digital_admin_page() -> FileResponse:
    if not ADMIN_DIGITAL_HTML.is_file():
        raise HTTPException(404, "digital admin HTML not found")
    return FileResponse(ADMIN_DIGITAL_HTML)


# --- CATALOG ENDPOINTS ---
@router.get("/catalog")
def get_catalog() -> list[dict[str, Any]]:
    return load_digital_catalog_json()


@router.post("/catalog")
def save_or_update_game(game: GameItem) -> dict[str, Any]:
    catalog = load_digital_catalog_json()
    existing_idx = next((i for i, item in enumerate(catalog) if item.get("id") == game.id), None)
    payload = game.model_dump()
    if existing_idx is not None:
        catalog[existing_idx] = payload
    else:
        catalog.append(payload)
    save_catalog_json(catalog)
    return {"ok": True, "game": payload}


@router.delete("/catalog/{app_id}")
def delete_game(app_id: int) -> dict[str, Any]:
    catalog = load_digital_catalog_json()
    new_catalog = [item for item in catalog if item.get("id") != app_id]
    if len(new_catalog) == len(catalog):
        raise HTTPException(404, f"Game with id {app_id} not found in catalog")
    save_catalog_json(new_catalog)
    return {"ok": True, "deleted_id": app_id}


@router.post("/catalog/clear")
def clear_catalog() -> dict[str, Any]:
    """Wipes the entire digital catalog (disk JSON + DB table) so it can be regenerated."""
    previous = len(load_digital_catalog_json())
    save_catalog_json([])
    return {"ok": True, "removed_games": previous}


# --- SOURCES ENDPOINTS ---
@router.get("/sources")
def get_sources() -> dict[str, Any]:
    cfg = load_sources_config()
    cache = load_cached_downloads()
    last_sync = None
    if CACHE_FILE.exists():
        try:
            with CACHE_FILE.open("r", encoding="utf-8") as f:
                cdata = json.load(f)
                last_sync = cdata.get("updated_at")
        except Exception:
            pass
    return {
        "ok": True,
        "sources": cfg.get("sources", []),
        "cached_items": len(cache),
        "last_sync": last_sync,
    }


@router.post("/sources")
def add_or_update_source(source: SourceItem) -> dict[str, Any]:
    cfg = load_sources_config()
    sources = cfg.get("sources", [])
    found = False
    for idx, s in enumerate(sources):
        if s.get("url") == source.url:
            s["label"] = source.label or s.get("label", "")
            s["enabled"] = source.enabled
            if "auto_installed" in source.model_fields_set:
                s["auto_installed"] = source.auto_installed
            if source.priority is not None:
                s["priority"] = source.priority
            found = True
            break
    if not found:
        sources.append({
            "url": source.url,
            "label": source.label or f"Servidor {len(sources) + 1}",
            "enabled": source.enabled,
            "auto_installed": source.auto_installed,
            "priority": source.priority if source.priority is not None else (len(sources) + 1),
            "added_at": datetime.now(timezone.utc).isoformat(),
        })
    sources.sort(key=lambda s: s.get("priority", 999))
    cfg["sources"] = sources
    save_sources_config(cfg)
    return {"ok": True, "source": source.model_dump()}


@router.post("/sources/priority")
def update_sources_priority(req: list[dict[str, Any]]) -> dict[str, Any]:
    cfg = load_sources_config()
    sources = cfg.get("sources", [])
    p_map = {item.get("url"): item.get("priority") for item in req if isinstance(item, dict) and "url" in item and "priority" in item}
    for s in sources:
        if s.get("url") in p_map:
            s["priority"] = int(p_map[s["url"]])
    sources.sort(key=lambda s: s.get("priority", 999))
    cfg["sources"] = sources
    save_sources_config(cfg)
    return {"ok": True, "sources": sources}


@router.delete("/sources")
def delete_source(req: DeleteSourceRequest) -> dict[str, Any]:
    cfg = load_sources_config()
    sources = cfg.get("sources", [])
    target = next((s for s in sources if s.get("url") == req.url), None)
    if target is None:
        raise HTTPException(404, f"Fuente no encontrada: {req.url}")
    filtered = [s for s in sources if s.get("url") != req.url]
    cfg["sources"] = filtered
    save_sources_config(cfg)

    # Remove the stored JSON file (only if it lives in our managed sources dir)
    removed_file = False
    try:
        sources_dir = (API_ROOT / "data" / "sources").resolve()
        file_path = Path(req.url).resolve()
        if file_path.is_file() and sources_dir in file_path.parents:
            file_path.unlink()
            removed_file = True
    except Exception as e:
        logger.warning("Could not remove source file %s: %s", req.url, e)

    # Purge this source's downloads from the cache
    label = target.get("label")
    cache = load_cached_downloads()
    kept = [
        d for d in cache
        if not (
            d.get("source_url") == req.url
            or (not d.get("source_url") and label and d.get("source") == label)
        )
    ]
    removed_items = len(cache) - len(kept)
    if removed_items:
        save_cached_downloads(kept)

    return {
        "ok": True,
        "deleted_url": req.url,
        "removed_file": removed_file,
        "removed_cached_items": removed_items,
    }





@router.post("/sources/sync")
async def sync_sources() -> dict[str, Any]:
    cfg = load_sources_config()
    sources = cfg.get("sources", [])
    all_downloads: list[dict[str, Any]] = []
    errors: list[str] = []
    synced_sources = 0

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers={"User-Agent": "GameAccess-Admin/1.0"}) as client:
        for idx, s in enumerate(sources):
            if not s.get("enabled", True):
                continue
            url = s.get("url", "")
            if not url:
                continue

            priority = s.get("priority")
            if priority is None:
                priority = idx + 1

            try:
                if Path(url).is_file():
                    with open(url, "r", encoding="utf-8") as f:
                        raw_data = json.load(f)
                else:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        errors.append(f"Servidor respondió {resp.status_code}: {url}")
                        continue
                    raw_data = resp.json()

                items = extract_hydra_items(
                    raw_data,
                    source_label=s.get("label", "Servidor"),
                    source_url=url,
                    source_priority=priority,
                )
                all_downloads.extend(items)
                synced_sources += 1
            except Exception as e:
                errors.append(f"Error al sincronizar {url}: {e}")

    if all_downloads:
        save_cached_downloads(all_downloads)

    return {
        "ok": len(errors) == 0 or len(all_downloads) > 0,
        "synced_sources": synced_sources,
        "total_items": len(all_downloads) if all_downloads else len(load_cached_downloads()),
        "errors": errors,
    }


def _process_auto_add_to_catalog_bg(items: list[dict[str, Any]], cfg: dict[str, Any]) -> None:
    catalog = load_digital_catalog_json()
    added_to_catalog = 0
    updated_in_catalog = 0
    deduped_import = deduplicate_download_items(items, cfg)
    catalog_names = {normalize_title(clean_user_friendly_title(c.get("name", ""))) for c in catalog}
    existing_ids = {c.get("id") for c in catalog if "id" in c}
    for it in deduped_import:
        norm = normalize_title(it["clean_title"])
        if not norm:
            continue
        if norm in catalog_names:
            for c in catalog:
                c_norm = normalize_title(clean_user_friendly_title(c.get("name", "")))
                if c_norm == norm and (not c.get("downloadSource") or c.get("downloadSource") == "auto"):
                    c["downloadSource"] = it["uri"]
                    updated_in_catalog += 1
            continue

        game_id = it.get("id")
        if not game_id:
            resolved = resolve_steam_app_id(it.get("raw_title") or it["clean_title"])
            if resolved:
                game_id, steam_name = resolved
                it["clean_title"] = steam_name
            else:
                logger.info("No official Steam AppID found for '%s', omitting fake ID", it["clean_title"])
                continue

        if game_id in existing_ids:
            for c in catalog:
                if c.get("id") == game_id and (not c.get("downloadSource") or c.get("downloadSource") == "auto"):
                    c["downloadSource"] = it["uri"]
                    updated_in_catalog += 1
            continue

        catalog.append({
            "name": it["clean_title"],
            "id": game_id,
            "downloadSource": it["uri"],
            "installProcess": "",
            "playProcess": "",
            "uninstallProcess": "",
        })
        existing_ids.add(game_id)
        catalog_names.add(norm)
        added_to_catalog += 1

    if added_to_catalog > 0 or updated_in_catalog > 0:
        save_catalog_json(catalog)


@router.post("/sources/import-json")
async def import_source_json(request: Request, background_tasks: BackgroundTasks) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(400, f"Error decodificando JSON: {e}")

    auto_add_to_catalog = True
    req_label = None

    if isinstance(body, dict):
        if "auto_add_to_catalog" in body:
            auto_add_to_catalog = bool(body.get("auto_add_to_catalog"))
        req_label = body.get("label")

        if "raw_json" in body and isinstance(body["raw_json"], str):
            try:
                data = json.loads(body["raw_json"])
            except Exception as e:
                raise HTTPException(400, f"El texto provisto en 'raw_json' no es un JSON válido: {e}")
        elif "json_data" in body:
            data = body["json_data"]
        else:
            # Direct Hydra JSON object (e.g. {"name": "...", "downloads": [...]})
            data = body
    else:
        # Direct list / array
        data = body

    # 1. Check if it is a Hydra source with downloads
    source_name = req_label or (data.get("name") if isinstance(data, dict) else None) or "Fuente Hydra"
    items = extract_hydra_items(data, source_label=source_name)
    if items:
        sources_dir = API_ROOT / "data" / "sources"
        sources_dir.mkdir(parents=True, exist_ok=True)
        safe_slug = re.sub(r"[^a-zA-Z0-9_\-]+", "_", source_name.lower()).strip("_") or "hydra_source"
        filename = f"{safe_slug}_{int(time.time())}.json"
        saved_file = sources_dir / filename
        raw_json_str = json.dumps(data, indent=2, ensure_ascii=False)
        with saved_file.open("w", encoding="utf-8") as f:
            f.write(raw_json_str)

        cfg = load_sources_config()
        sources_list = cfg.get("sources", [])
        existing = next((s for s in sources_list if s.get("url") == str(saved_file)), None)
        if existing:
            existing["label"] = source_name
            existing["items_count"] = len(items)
            existing["updated_at"] = datetime.now(timezone.utc).isoformat()
            existing["raw_content"] = raw_json_str
        else:
            sources_list.append({
                "url": str(saved_file),
                "label": source_name,
                "enabled": True,
                "type": "hydra_source",
                "added_at": datetime.now(timezone.utc).isoformat(),
                "items_count": len(items),
                "raw_content": raw_json_str,
            })
        cfg["sources"] = sources_list
        save_sources_config(cfg)

        # Update cache
        current_cache = load_cached_downloads()
        existing_uris = {d.get("uri") for d in current_cache if "uri" in d}
        new_downloads = [it for it in items if it.get("uri") not in existing_uris]
        updated_cache = current_cache + new_downloads
        save_cached_downloads(updated_cache)

        # Auto add to catalog if requested
        if auto_add_to_catalog:
            background_tasks.add_task(_process_auto_add_to_catalog_bg, items, cfg)
            msg = f"Fuente '{source_name}' importada exitosamente. Se indexaron {len(items)} paquetes de descarga. La sincronización con el catálogo se ejecutará en segundo plano."
        else:
            msg = f"Fuente '{source_name}' importada exitosamente. Se indexaron {len(items)} paquetes de descarga."

        return {
            "ok": True,
            "mode": "hydra_source",
            "source_name": source_name,
            "indexed_items": len(items),
            "message": msg,
        }

    # 2. Check if it is a list of source URLs
    urls = []
    if isinstance(data, list):
        for entry in data:
            if isinstance(entry, str) and entry.startswith("http"):
                urls.append(entry)
            elif isinstance(entry, dict) and entry.get("url"):
                urls.append(entry["url"])
    elif isinstance(data, dict) and "sources" in data and isinstance(data["sources"], list):
        for entry in data["sources"]:
            if isinstance(entry, str) and entry.startswith("http"):
                urls.append(entry)
            elif isinstance(entry, dict) and entry.get("url"):
                urls.append(entry["url"])

    if urls:
        cfg = load_sources_config()
        current_sources = cfg.get("sources", [])
        existing_urls = {s.get("url") for s in current_sources}
        added = 0
        for u in urls:
            if u not in existing_urls:
                current_sources.append({
                    "url": u,
                    "label": f"Fuente {len(current_sources) + 1}",
                    "enabled": True,
                    "added_at": datetime.now(timezone.utc).isoformat(),
                })
                existing_urls.add(u)
                added += 1
        cfg["sources"] = current_sources
        save_sources_config(cfg)

        sync_res = await sync_sources()
        return {
            "ok": True,
            "mode": "sources_list",
            "sources_added": added,
            "sync_result": sync_res,
            "message": f"Se importaron {added} fuentes de Hydra a la lista y se sincronizaron ({sync_res.get('total_items', 0)} paquetes indexados).",
        }

    # 3. Check if it is a catalog of games
    if isinstance(data, list) and len(data) > 0 and all(isinstance(x, dict) and ("name" in x or "title" in x) for x in data):
        catalog = load_digital_catalog_json()
        existing_ids = {c.get("id") for c in catalog}
        catalog_names = {normalize_title(c.get("name", "")) for c in catalog}
        added = 0
        for g in data:
            title = g.get("name") or g.get("title")
            norm = normalize_title(title)
            gid = g.get("id") or g.get("app_id")
            if not gid:
                resolved = resolve_steam_app_id(title)
                if resolved:
                    gid, steam_name = resolved
                    title = steam_name
                else:
                    logger.info("No official Steam AppID found for '%s', omitting fake ID", title)
                    continue

            if gid in existing_ids:
                continue

            dl_source = g.get("downloadSource") or g.get("download_source") or g.get("uri") or g.get("url") or ""
            if norm not in catalog_names:
                catalog.append({
                    "name": title,
                    "id": gid,
                    "downloadSource": dl_source,
                    "installProcess": g.get("installProcess", ""),
                    "playProcess": g.get("playProcess", ""),
                    "uninstallProcess": g.get("uninstallProcess", ""),
                })
                existing_ids.add(gid)
                catalog_names.add(norm)
                added += 1

        save_catalog_json(catalog)
        return {
            "ok": True,
            "mode": "catalog",
            "games_imported": added,
            "total_games": len(catalog),
            "message": f"Se importaron {added} juegos al catálogo digital.",
        }

    raise HTTPException(400, "El formato del JSON no es reconocido como fuente de Hydra (debe contener un listado de 'downloads' o una lista de fuentes).")

SYNC_STATUS = {
    "is_running": False,
    "task_type": "",
    "processed": 0,
    "total": 0,
    "current_item": "",
    "message": ""
}

@router.get("/catalog/sync-status")
def get_sync_status() -> dict[str, Any]:
    return SYNC_STATUS








@router.get("/source/{game_id}")
def get_admin_digital_source(game_id: int, name: Optional[str] = Query(None)) -> dict[str, Any]:
    catalog = load_digital_catalog_json()
    for item in catalog:
        if item.get("id") == game_id:
            src = str(item.get("downloadSource") or "").strip()
            if src and src.lower() != "auto":
                return {"ok": True, "id": game_id, "name": item.get("name"), "uri": src}
            if not name:
                name = item.get("name")

    if name:
        cached = load_cached_downloads()
        cfg = load_sources_config()
        sources_list = cfg.get("sources", [])
        priority_map: dict[str, int] = {}
        for idx, s in enumerate(sources_list):
            p = s.get("priority")
            if p is None:
                p = idx + 1
            if s.get("url"):
                priority_map[s["url"]] = p
            if s.get("label"):
                priority_map[s["label"]] = p

        scored = []
        for c in cached:
            score = calculate_match_score(name, c.get("raw_title", ""))
            if score >= 0.55:
                scored.append((score, c))
        if scored:
            scored.sort(
                key=lambda x: (
                    -round(x[0], 2),
                    rank_download_candidate(x[1], priority_map)
                )
            )
            best = scored[0][1]
            return {
                "ok": True,
                "id": game_id,
                "name": name,
                "uri": best.get("uri"),
                "size": best.get("file_size"),
                "source": best.get("source"),
            }

    raise HTTPException(404, detail="No download source found for this game")


@router.post("/raw-json")
def save_raw_json(data: Any, target: str = Query(..., pattern="^(catalog|sources)$")) -> dict[str, Any]:
    if target == "catalog":
        if not isinstance(data, list):
            raise HTTPException(400, "El contenido de digital_catalog.json debe ser un array de objetos.")
        for item in data:
            if not isinstance(item, dict) or "id" not in item:
                raise HTTPException(400, "Cada elemento del catálogo debe ser un objeto con al menos un campo 'id'.")
        save_catalog_json(data)
        return {"ok": True, "target": target, "count": len(data)}
    else:
        if isinstance(data, list):
            data = {"sources": data}
        if not isinstance(data, dict) or "sources" not in data:
            raise HTTPException(400, "El contenido de digital_sources.json debe tener un campo 'sources'.")
        save_sources_config(data)
        return {"ok": True, "target": target, "count": len(data.get("sources", []))}


def _sync_steam_progress(processed: int, total: int, current_item: str) -> None:
    global SYNC_STATUS
    SYNC_STATUS["processed"] = processed
    SYNC_STATUS["total"] = total
    SYNC_STATUS["current_item"] = current_item

def _sync_steam_bg() -> None:
    global SYNC_STATUS
    SYNC_STATUS["is_running"] = True
    SYNC_STATUS["task_type"] = "sync_steam"
    SYNC_STATUS["processed"] = 0
    SYNC_STATUS["total"] = 0
    SYNC_STATUS["current_item"] = ""
    SYNC_STATUS["message"] = "Iniciando sincronización con Steam Store..."

    try:
        res = sync_digital_catalog(engine=default_engine, force=True, progress_callback=_sync_steam_progress)
        SYNC_STATUS["message"] = f"Completado. {res.get('processed', 0)} procesados, {res.get('steam_enriched', 0)} actualizados con datos de Steam."
    except Exception as e:
        logger.error(f"Error en sync_steam_bg: {e}")
        SYNC_STATUS["message"] = f"Error: {str(e)}"
    finally:
        SYNC_STATUS["is_running"] = False

@router.post("/sync-steam")
def trigger_steam_sync(background_tasks: BackgroundTasks) -> dict[str, Any]:
    global SYNC_STATUS
    if SYNC_STATUS["is_running"]:
        return {"ok": False, "message": "Ya hay un proceso en ejecución."}

    background_tasks.add_task(_sync_steam_bg)
    return {"ok": True, "message": "Sincronización con Steam iniciada en segundo plano."}


def restore_or_sync_digital_storage(engine_override: Any = None) -> None:
    """Restores persistent digital catalog, sources, and cached downloads from database across deployments.

    On platforms like Render where web services run on ephemeral containers, the filesystem
    is reset on every deploy/restart. This function ensures that everything previously imported
    into the database is seamlessly restored to local files on boot.
    """
    db_engine = engine_override or default_engine
    try:
        from sqlmodel import SQLModel
        SQLModel.metadata.create_all(db_engine)
    except Exception as e:
        logger.warning("Could not ensure SQLModel metadata tables: %s", e)

    # 1. Restore/Sync Catalog
    try:
        db_games = load_digital_catalog_from_db(db_engine)
        disk_games = []
        path = get_digital_catalog_path()
        if path.exists():
            try:
                with path.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        disk_games = [item for item in data if isinstance(item, dict) and "id" in item]
            except Exception:
                disk_games = []

        if db_games:
            # Merge: DB games take precedence, but if disk has games not in DB (e.g. from repo commit), add them to DB
            merged_by_id = {g["id"]: g for g in db_games}
            disk_new = 0
            for dg in disk_games:
                if dg.get("id") and dg["id"] not in merged_by_id:
                    merged_by_id[dg["id"]] = dg
                    disk_new += 1
            all_games = list(merged_by_id.values())
            save_catalog_json(all_games)
            logger.info("Restored digital catalog with %d games (%d from DB, %d new from repo)", len(all_games), len(db_games), disk_new)
        elif disk_games:
            # First run on fresh DB: seed DB from repository's digital_catalog.json
            sync_catalog_to_db(disk_games, db_engine)
            logger.info("Seeded database with %d digital catalog games from repository JSON", len(disk_games))
    except Exception as e:
        logger.warning("Error syncing digital catalog on startup: %s", e)

    # 2. Restore/Sync Sources
    try:
        with Session(db_engine) as session:
            db_sources = session.exec(select(DigitalSourceRecord)).all()
            sources_dir = API_ROOT / "data" / "sources"
            sources_dir.mkdir(parents=True, exist_ok=True)
            sources_list = []
            for s in db_sources:
                target_url = s.url
                # If this was an uploaded source file with raw_content saved in DB
                if s.raw_content:
                    file_name = Path(s.url).name
                    if not file_name.endswith(".json"):
                        file_name = f"source_{s.id or 1}.json"
                    local_file = sources_dir / file_name
                    if not local_file.exists():
                        try:
                            with local_file.open("w", encoding="utf-8") as f:
                                f.write(s.raw_content)
                            logger.info("Restored uploaded source file on disk: %s", local_file)
                        except Exception as fe:
                            logger.warning("Could not recreate source file %s: %s", local_file, fe)
                    target_url = str(local_file)

                sources_list.append({
                    "url": target_url,
                    "label": s.label,
                    "enabled": s.enabled,
                    "priority": s.priority,
                    "type": s.source_type,
                    "items_count": s.items_count,
                    "added_at": s.added_at,
                })

            if sources_list:
                sources_list.sort(key=lambda x: x.get("priority", 999))
                # Write to disk
                sources_path = get_sources_path()
                sources_path.parent.mkdir(parents=True, exist_ok=True)
                with sources_path.open("w", encoding="utf-8") as f:
                    json.dump({"sources": sources_list}, f, indent=2, ensure_ascii=False)
                logger.info("Restored %d sources to %s", len(sources_list), sources_path)
            else:
                # Seed DB from disk if digital_sources.json exists and has sources
                disk_cfg = load_sources_config()
                if disk_cfg.get("sources"):
                    save_sources_config(disk_cfg)
    except Exception as e:
        logger.warning("Error syncing sources on startup: %s", e)

    # 3. Restore/Sync Cached Downloads
    try:
        if not CACHE_FILE.exists() or CACHE_FILE.stat().st_size == 0:
            with Session(db_engine) as session:
                cache_rec = session.exec(select(DigitalCacheRecord).where(DigitalCacheRecord.id == 1)).first()
                if cache_rec and cache_rec.payload:
                    downloads = json.loads(cache_rec.payload)
                    CACHE_DIR.mkdir(parents=True, exist_ok=True)
                    with CACHE_FILE.open("w", encoding="utf-8") as f:
                        json.dump({
                            "updated_at": cache_rec.updated_at or datetime.now(timezone.utc).isoformat(),
                            "total_items": len(downloads),
                            "downloads": downloads,
                        }, f, ensure_ascii=False)
                    logger.info("Restored %d cached downloads from database to %s", len(downloads), CACHE_FILE)
        else:
            # If cache file exists on disk but DB is empty, seed DB
            with Session(db_engine) as session:
                cache_rec = session.exec(select(DigitalCacheRecord).where(DigitalCacheRecord.id == 1)).first()
                if not cache_rec:
                    disk_downloads = load_cached_downloads()
                    if disk_downloads:
                        save_cached_downloads(disk_downloads)
    except Exception as e:
        logger.warning("Error syncing cached downloads on startup: %s", e)


@router.post("/catalog/add-steam-game/{steam_id}")
def add_steam_game(steam_id: int) -> dict[str, Any]:
    """Agrega un juego de Steam al catálogo general descargando sus metadatos básicos."""
    from .steam_catalog import SteamCatalogAdapter
    
    adapter = SteamCatalogAdapter()
    details = adapter.fetch_game_details(steam_id)
    if not details:
        raise HTTPException(404, "No se pudo obtener información de Steam para este ID.")
        
    game_name = details.get("name", f"Steam Game {steam_id}")
    
    # Lo guardamos en el JSON del catálogo genérico
    catalog = load_digital_catalog_json()
    
    # Check if exists
    if any(g.get("id") == steam_id for g in catalog):
        return {"ok": True, "message": "El juego ya estaba en el catálogo genérico", "game": game_name}
        
    new_game = {
        "id": steam_id,
        "name": game_name,
        "image": details.get("header_image", ""),
        "steam_id": steam_id,
        "release_date": details.get("release_date", {}).get("date", ""),
        "type": "digital"
    }
    catalog.append(new_game)
    save_catalog_json(catalog)
    
    # Sincronizamos la base de datos local para que quede listo para las búsquedas
    from .digital_catalog import sync_digital_catalog
    sync_digital_catalog(force=True)
    
    return {"ok": True, "message": f"Agregado {game_name} al catálogo.", "game": new_game}


@router.post("/catalog/seed-top-steam")
def seed_top_steam_games() -> dict[str, Any]:
    """Descarga los 100 juegos más populares de SteamSpy y los agrega al catálogo general."""
    try:
        # Usamos SteamSpy API que es pública y gratuita
        resp = httpx.get("https://steamspy.com/api.php?request=top100in2weeks", timeout=30.0)
        if resp.status_code != 200:
            raise HTTPException(500, "Error contactando SteamSpy")
            
        data = resp.json()
        catalog = load_digital_catalog_json()
        existing_ids = {g.get("id") for g in catalog}
        
        added = 0
        for app_id_str, info in data.items():
            steam_id = int(app_id_str)
            if steam_id in existing_ids:
                continue
                
            new_game = {
                "id": steam_id,
                "name": info.get("name", ""),
                "image": f"https://cdn.akamai.steamstatic.com/steam/apps/{steam_id}/header.jpg",
                "steam_id": steam_id,
                "type": "digital"
            }
            catalog.append(new_game)
            added += 1
            
        if added > 0:
            save_catalog_json(catalog)
            from .digital_catalog import sync_digital_catalog
            # Sync to SQLite without forcing heavy Steam Store updates yet
            sync_digital_catalog(force=False)
            
        return {"ok": True, "added": added, "total": len(catalog)}
    except Exception as e:
        logger.error(f"Error seeding steam catalog: {e}")
        raise HTTPException(500, str(e))
