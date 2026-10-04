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


def extract_hydra_items(raw_data: Any, source_label: str = "Fuente") -> list[dict[str, Any]]:
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

    items = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("name") or "").strip()
        if not title:
            continue
        uris = item.get("uris") or item.get("urls") or []
        if isinstance(uris, str):
            uris = [uris]
        elif not isinstance(uris, list):
            uris = []
        if not uris and item.get("uri"):
            uris = [item["uri"]]
        if not uris and item.get("url"):
            uris = [item["url"]]

        valid_uris = [str(u).strip() for u in uris if u and isinstance(u, (str, int)) and str(u).strip()]
        if not valid_uris:
            continue

        raw_id = item.get("id") or item.get("app_id") or item.get("steam_app_id")

        items.append({
            "raw_title": title,
            "clean_title": clean_user_friendly_title(title),
            "uri": valid_uris[0],
            "uris": valid_uris,
            "file_size": str(item.get("fileSize") or item.get("file_size") or item.get("size") or "Estándar").strip(),
            "upload_date": str(item.get("uploadDate") or item.get("date") or "").strip(),
            "source": source_label,
            "id": int(raw_id) if isinstance(raw_id, (int, str)) and str(raw_id).isdigit() else None,
        })
    return items


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

                items = extract_hydra_items(raw_data, source_label=s.get("label", "Servidor"))
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


@router.post("/sources/import-json")
async def import_source_json(request: Request) -> dict[str, Any]:
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
        with saved_file.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        cfg = load_sources_config()
        sources_list = cfg.get("sources", [])
        existing = next((s for s in sources_list if s.get("url") == str(saved_file)), None)
        if existing:
            existing["label"] = source_name
            existing["items_count"] = len(items)
            existing["updated_at"] = datetime.now(timezone.utc).isoformat()
        else:
            sources_list.append({
                "url": str(saved_file),
                "label": source_name,
                "enabled": True,
                "type": "hydra_source",
                "added_at": datetime.now(timezone.utc).isoformat(),
                "items_count": len(items),
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
        added_to_catalog = 0
        updated_in_catalog = 0
        catalog = load_digital_catalog_json()
        if auto_add_to_catalog:
            catalog_names = {normalize_title(c.get("name", "")) for c in catalog}
            existing_ids = {c.get("id") for c in catalog if "id" in c}
            for it in items:
                norm = normalize_title(it["clean_title"])
                if not norm:
                    continue
                if norm in catalog_names:
                    for c in catalog:
                        if normalize_title(c.get("name", "")) == norm and not c.get("downloadSource"):
                            c["downloadSource"] = it["uri"]
                            updated_in_catalog += 1
                    continue

                game_id = it.get("id")
                if not game_id or game_id in existing_ids:
                    base_id = abs(hash(norm)) % 8000000 + 1000000
                    while base_id in existing_ids:
                        base_id += 1
                    game_id = base_id

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

        return {
            "ok": True,
            "mode": "hydra_source",
            "source_name": source_name,
            "indexed_items": len(items),
            "added_to_catalog": added_to_catalog,
            "updated_in_catalog": updated_in_catalog,
            "total_catalog_games": len(catalog),
            "message": f"Fuente '{source_name}' importada exitosamente. Se indexaron {len(items)} paquetes de descarga y se sincronizaron {added_to_catalog} juegos al catálogo.",
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
            if not gid or gid in existing_ids:
                base_id = abs(hash(norm)) % 8000000 + 1000000
                while base_id in existing_ids:
                    base_id += 1
                gid = base_id

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


@router.post("/catalog/populate-from-sources")
def populate_catalog_from_sources() -> dict[str, Any]:
    cached = load_cached_downloads()
    if not cached:
        raise HTTPException(400, "No hay descargas indexadas en la caché. Agrega o importa fuentes primero.")

    catalog = load_digital_catalog_json()
    catalog_names = {normalize_title(c.get("name", "")) for c in catalog}
    existing_ids = {c.get("id") for c in catalog if "id" in c}
    added_count = 0
    updated_count = 0

    for item in cached:
        title = item.get("clean_title") or item.get("raw_title", "")
        norm = normalize_title(title)
        if not norm:
            continue
        if norm in catalog_names:
            for c in catalog:
                if normalize_title(c.get("name", "")) == norm and not c.get("downloadSource"):
                    c["downloadSource"] = item["uri"]
                    updated_count += 1
            continue

        game_id = item.get("id")
        if not game_id or game_id in existing_ids:
            base_id = abs(hash(norm)) % 8000000 + 1000000
            while base_id in existing_ids:
                base_id += 1
            game_id = base_id

        catalog.append({
            "name": title,
            "id": game_id,
            "downloadSource": item["uri"],
            "installProcess": "",
            "playProcess": "",
            "uninstallProcess": "",
        })
        existing_ids.add(game_id)
        catalog_names.add(norm)
        added_count += 1

    save_catalog_json(catalog)
    return {
        "ok": True,
        "added_games": added_count,
        "updated_sources": updated_count,
        "total_catalog_games": len(catalog),
        "message": f"Catálogo digital actualizado: {added_count} nuevos juegos agregados y {updated_count} fuentes vinculadas.",
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
 
 
@router.get("/source/{game_id}")
def get_admin_digital_source(game_id: int, name: Optional[str] = Query(None)) -> dict[str, Any]:
    catalog = load_digital_catalog_json()
    for item in catalog:
        if item.get("id") == game_id:
            src = str(item.get("downloadSource") or "").strip()
            if src:
                return {"ok": True, "id": game_id, "name": item.get("name"), "uri": src}
            if not name:
                name = item.get("name")

    if name:
        cached = load_cached_downloads()
        scored = []
        for c in cached:
            score = calculate_match_score(name, c.get("raw_title", ""))
            if score >= 0.55:
                scored.append((score, c))
        if scored:
            scored.sort(key=lambda x: (x[0], x[1].get("upload_date", "")), reverse=True)
            best = scored[0][1]
            return {"ok": True, "id": game_id, "name": name, "uri": best.get("uri"), "size": best.get("file_size")}

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


@router.post("/sync-steam")
def trigger_steam_sync() -> dict[str, Any]:
    return sync_digital_catalog(engine=default_engine, force=True)
