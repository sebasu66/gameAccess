from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlmodel import Session

from . import main as core
from .digital_catalog import get_digital_catalog_path, load_digital_catalog_json, sync_digital_catalog
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
    url: str = Field(min_length=3)
    label: str = ""
    enabled: bool = True


class DeleteSourceRequest(BaseModel):
    url: str


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
    if not path.exists():
        return {"sources": []}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {"sources": []}
    except Exception as e:
        logger.warning("Error reading digital_sources.json: %s", e)
        return {"sources": []}


def save_sources_config(data: dict[str, Any]) -> None:
    path = get_sources_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def save_catalog_json(items: list[dict[str, Any]]) -> None:
    path = get_digital_catalog_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)


def normalize_title(title: str) -> str:
    if not title:
        return ""
    text = title.lower()
    text = re.sub(r"\[.*?\]", " ", text)
    text = re.sub(r"\bv\d+[\d._]*\b", " ", text)
    text = re.sub(r"\bbuild\s*\d+\b", " ", text)
    text = text.replace("&", " and ").replace("+", " and ")
    for roman, arabic in ROMAN_NUMERALS.items():
        text = re.sub(roman, arabic, text)
    text = re.sub(r"[:\-_,.'\"!/?(){}]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def clean_user_friendly_title(raw_title: str) -> str:
    cleaned = NOISE_TERMS_PATTERN.sub("", raw_title)
    cleaned = re.sub(r"\bv\d+[\d._]*\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bbuild\s*\d+\b", "", cleaned, flags=re.IGNORECASE)
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


def calculate_match_score(target_name: str, candidate_title: str) -> float:
    norm_target = normalize_title(target_name)
    norm_candidate = normalize_title(candidate_title)

    target_tokens = [t for t in norm_target.split() if t not in ("the", "of", "and", "a", "an", "for")]
    candidate_tokens = [t for t in norm_candidate.split() if t not in ("the", "of", "and", "a", "an", "for")]

    if not target_tokens:
        return 0.0

    target_set = set(target_tokens)
    candidate_set = set(candidate_tokens)
    matching = target_set.intersection(candidate_set)

    ratio = len(matching) / len(target_set)
    if ratio < 0.75:
        return 0.0

    target_numbers = {t for t in target_tokens if t.isdigit() and len(t) <= 2}
    candidate_numbers = {t for t in candidate_tokens if t.isdigit() and len(t) <= 2}
    if target_numbers and not target_numbers.issubset(candidate_numbers):
        return 0.0
    if not target_numbers and candidate_numbers:
        return 0.0

    seq_ratio = SequenceMatcher(None, norm_target, norm_candidate).ratio()
    return (ratio * 0.6) + (seq_ratio * 0.4)


def load_cached_downloads() -> list[dict[str, Any]]:
    if not CACHE_FILE.exists():
        return []
    try:
        with CACHE_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("downloads", [])
    except Exception:
        return []


def save_cached_downloads(downloads: list[dict[str, Any]]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with CACHE_FILE.open("w", encoding="utf-8") as f:
        json.dump({
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "total_items": len(downloads),
            "downloads": downloads,
        }, f, ensure_ascii=False)


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
    for s in sources:
        if s.get("url") == source.url:
            s["label"] = source.label or s.get("label", "")
            s["enabled"] = source.enabled
            found = True
            break
    if not found:
        sources.append({
            "url": source.url,
            "label": source.label or f"Servidor {len(sources) + 1}",
            "enabled": source.enabled,
            "added_at": datetime.now(timezone.utc).isoformat(),
        })
    cfg["sources"] = sources
    save_sources_config(cfg)
    return {"ok": True, "source": source.model_dump()}


@router.delete("/sources")
def delete_source(req: DeleteSourceRequest) -> dict[str, Any]:
    cfg = load_sources_config()
    sources = cfg.get("sources", [])
    filtered = [s for s in sources if s.get("url") != req.url]
    cfg["sources"] = filtered
    save_sources_config(cfg)
    return {"ok": True, "deleted_url": req.url}


@router.post("/sources/sync")
async def sync_sources() -> dict[str, Any]:
    cfg = load_sources_config()
    sources = cfg.get("sources", [])
    all_downloads: list[dict[str, Any]] = []
    errors: list[str] = []
    synced_sources = 0

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers={"User-Agent": "GameAccess-Admin/1.0"}) as client:
        for s in sources:
            if not s.get("enabled", True):
                continue
            url = s.get("url", "")
            if not url:
                continue

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

                # Extract items
                raw_list = []
                if isinstance(raw_data, dict):
                    if "downloads" in raw_data and isinstance(raw_data["downloads"], list):
                        raw_list = raw_data["downloads"]
                    elif "items" in raw_data and isinstance(raw_data["items"], list):
                        raw_list = raw_data["items"]
                elif isinstance(raw_data, list):
                    for entry in raw_data:
                        if isinstance(entry, dict) and "downloads" in entry:
                            raw_list.extend(entry["downloads"])
                        elif isinstance(entry, dict):
                            raw_list.append(entry)

                for item in raw_list:
                    if not isinstance(item, dict):
                        continue
                    title = item.get("title") or item.get("name") or ""
                    if not title:
                        continue
                    uris = item.get("uris") or item.get("urls") or []
                    if isinstance(uris, str):
                        uris = [uris]
                    if not uris and item.get("uri"):
                        uris = [item["uri"]]
                    if not uris and item.get("url"):
                        uris = [item["url"]]
                    if not uris:
                        continue

                    all_downloads.append({
                        "raw_title": title,
                        "clean_title": clean_user_friendly_title(title),
                        "uri": uris[0],
                        "file_size": item.get("fileSize") or item.get("file_size") or item.get("size") or "Estándar",
                        "upload_date": item.get("uploadDate") or item.get("date") or "",
                        "source": s.get("label", "Servidor"),
                    })

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


@router.get("/resolve-options")
def resolve_options_for_game(name: str = Query(..., min_length=1)) -> dict[str, Any]:
    cached = load_cached_downloads()
    scored = []
    for item in cached:
        score = calculate_match_score(name, item["raw_title"])
        if score >= 0.55:
            scored.append((score, item))

    scored.sort(key=lambda x: (x[0], x[1].get("upload_date", "")), reverse=True)

    results = []
    for idx, (score, item) in enumerate(scored, start=1):
        badge = "Recomendada" if idx == 1 else "Alternativa"
        results.append({
            "id": f"opt-{idx}",
            "title": item["clean_title"],
            "size": item["file_size"],
            "badge": badge,
            "uri": item["uri"],
            "score": round(score, 2),
        })

    return {"ok": True, "game": name, "count": len(results), "options": results}


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


@router.post("/sync-steam")
def trigger_steam_sync() -> dict[str, Any]:
    return sync_digital_catalog(engine=default_engine, force=True)
