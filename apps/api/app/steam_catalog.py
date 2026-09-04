from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx


class SteamCatalogError(RuntimeError):
    pass


def steam_assets(app_id: int | None) -> dict[str, str | None]:
    if not app_id:
        return {
            "header_image": None,
            "capsule_image": None,
            "hero_image": None,
            "steam_url": None,
        }
    base = f"https://cdn.akamai.steamstatic.com/steam/apps/{app_id}"
    return {
        "header_image": f"{base}/header.jpg",
        "capsule_image": f"{base}/library_600x900_2x.jpg",
        "hero_image": f"{base}/library_hero.jpg",
        "steam_url": f"https://store.steampowered.com/app/{app_id}/",
    }


class SteamCatalogAdapter:
    """Small, cache-first adapter over Steam Store's public app-details response.

    It is intentionally isolated from the rest of the backend so the transport
    can be replaced later without changing the product-facing catalog schema.
    The adapter never needs a Steam account, password, API key or session token.
    """

    def __init__(self, cache_dir: Path, ttl_seconds: int = 7 * 24 * 60 * 60) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = ttl_seconds

    def _cache_path(self, app_id: int, language: str, country: str) -> Path:
        safe_language = "".join(c for c in language if c.isalnum() or c in "_-") or "spanish"
        safe_country = "".join(c for c in country if c.isalnum() or c in "_-") or "ar"
        return self.cache_dir / f"{app_id}-{safe_language}-{safe_country}.json"

    def _read_cache(self, app_id: int, language: str, country: str, allow_stale: bool = False) -> dict[str, Any] | None:
        path = self._cache_path(app_id, language, country)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not allow_stale and time.time() - float(payload.get("cached_at", 0)) > self.ttl_seconds:
                return None
            data = payload.get("data")
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def _write_cache(self, app_id: int, language: str, country: str, data: dict[str, Any]) -> None:
        path = self._cache_path(app_id, language, country)
        payload = {"cached_at": time.time(), "data": data}
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    def fetch(self, app_id: int, language: str = "spanish", country: str = "ar", force: bool = False) -> dict[str, Any]:
        if not force:
            cached = self._read_cache(app_id, language, country)
            if cached:
                return cached

        try:
            with httpx.Client(timeout=10.0, follow_redirects=True) as client:
                response = client.get(
                    "https://store.steampowered.com/api/appdetails",
                    params={"appids": str(app_id), "l": language, "cc": country},
                    headers={"User-Agent": "gameAccess/0.1 catalog prototype"},
                )
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            cached = self._read_cache(app_id, language, country, allow_stale=True)
            if cached:
                return cached
            raise SteamCatalogError(f"Steam metadata request failed for AppID {app_id}: {exc}") from exc

        entry = payload.get(str(app_id)) if isinstance(payload, dict) else None
        if not isinstance(entry, dict) or not entry.get("success") or not isinstance(entry.get("data"), dict):
            raise SteamCatalogError(f"Steam returned no app details for AppID {app_id}")

        normalized = self._normalize(app_id, entry["data"])
        self._write_cache(app_id, language, country, normalized)
        return normalized

    def _normalize(self, app_id: int, raw: dict[str, Any]) -> dict[str, Any]:
        assets = steam_assets(app_id)
        screenshots = [
            {
                "id": item.get("id"),
                "thumbnail": item.get("path_thumbnail"),
                "full": item.get("path_full"),
            }
            for item in raw.get("screenshots", [])
            if isinstance(item, dict)
        ]

        movies = []
        for item in raw.get("movies", []) or []:
            if not isinstance(item, dict):
                continue
            mp4 = item.get("mp4") if isinstance(item.get("mp4"), dict) else {}
            webm = item.get("webm") if isinstance(item.get("webm"), dict) else {}
            movies.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "thumbnail": item.get("thumbnail"),
                    "mp4": mp4.get("max") or mp4.get("480"),
                    "webm": webm.get("max") or webm.get("480"),
                    "highlight": bool(item.get("highlight")),
                }
            )

        price = raw.get("price_overview") if isinstance(raw.get("price_overview"), dict) else None
        release = raw.get("release_date") if isinstance(raw.get("release_date"), dict) else {}
        recommendations = raw.get("recommendations") if isinstance(raw.get("recommendations"), dict) else {}
        achievements = raw.get("achievements") if isinstance(raw.get("achievements"), dict) else {}
        requirements = raw.get("pc_requirements") if isinstance(raw.get("pc_requirements"), dict) else {}

        return {
            "app_id": app_id,
            "name": raw.get("name"),
            "type": raw.get("type"),
            "short_description": raw.get("short_description"),
            "about_the_game": raw.get("about_the_game"),
            "detailed_description": raw.get("detailed_description"),
            "developers": raw.get("developers") or [],
            "publishers": raw.get("publishers") or [],
            "genres": [item.get("description") for item in raw.get("genres", []) if isinstance(item, dict) and item.get("description")],
            "categories": [item.get("description") for item in raw.get("categories", []) if isinstance(item, dict) and item.get("description")],
            "supported_languages": raw.get("supported_languages"),
            "release_date": release.get("date"),
            "coming_soon": bool(release.get("coming_soon")),
            "required_age": raw.get("required_age"),
            "metacritic": raw.get("metacritic"),
            "recommendation_count": recommendations.get("total"),
            "achievement_count": achievements.get("total"),
            "price": price,
            "is_free": bool(raw.get("is_free")),
            "windows": bool((raw.get("platforms") or {}).get("windows")),
            "mac": bool((raw.get("platforms") or {}).get("mac")),
            "linux": bool((raw.get("platforms") or {}).get("linux")),
            "minimum_requirements": requirements.get("minimum"),
            "recommended_requirements": requirements.get("recommended"),
            "screenshots": screenshots,
            "movies": movies,
            "header_image": raw.get("header_image") or assets["header_image"],
            "capsule_image": raw.get("capsule_imagev5") or assets["capsule_image"],
            "hero_image": assets["hero_image"],
            "background": raw.get("background_raw") or raw.get("background") or assets["hero_image"],
            "steam_url": assets["steam_url"],
            "source": "steam-store",
        }
