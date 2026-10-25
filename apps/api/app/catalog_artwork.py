"""Resolve real Steam asset URLs and official age ratings for the catalog.

The catalog must never guess an artwork URL, and it must not rely on community
tags to decide what is adult content. Steam serves covers from hashed paths that
cannot be derived from the AppID, and community tags are applied by users: they
mark Mortal Kombat 11 as "Sexual Content" although Valve lists no sexual
descriptor for it, and across a 150-game sample they flagged 7 games where the
official descriptors flag 31.

Both answers come from the same store request, so resolving them together costs
nothing extra. Cover URLs are measured: guessed `library_600x900_2x.jpg` paths
answer HTTP 200 for roughly 44% of games, while the hashed URLs returned here
answer 200 for 199 of 200 sampled games.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from pathlib import Path

import httpx

LOG = logging.getLogger("gameaccess.artwork")

STORE_API = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
ASSET_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/"
USER_AGENT = "GameAccess/1.0 discovery catalog (metadata only)"
# The endpoint accepts a batch of ids per call; 50 keeps the query string sane.
BATCH_SIZE = 50
# Bump when the resolved payload gains a field. The cache key includes it so
# batches written before a field existed are refetched rather than misread as
# "the API returned nothing" for that field.
CACHE_VERSION = 2

# Valve's content descriptor ids, confirmed against known titles:
#   1 = some nudity or sexual content      -> South Park, Dragon's Dogma 2
#   2 = frequent violence or gore          -> Mortal Kombat 11, Helldivers 2
#   3 = adult only sexual content          -> present on every explicit title
#                                            tested, never on a mainstream one
#   4 = ships with 3 on every adult title  -> part of the adult-only flag
#   5 = general mature content             -> Dota 2, Rainbow Six Siege
ADULT_ONLY_DESCRIPTORS = frozenset({3, 4})
NUDITY_DESCRIPTORS = frozenset({1})
VIOLENCE_DESCRIPTORS = frozenset({2, 5})


def asset_url(format_template: str, filename: str) -> str | None:
    """Join the API's url format with a filename, refusing unsafe input."""
    if not format_template or not filename:
        return None
    if ".." in filename or ".." in format_template:
        return None
    if not format_template.startswith("steam/apps/"):
        return None
    return ASSET_BASE + format_template.replace("${FILENAME}", filename)


def assets_from_item(item: dict) -> dict[str, str | None]:
    """Pick the real asset URLs out of one store item."""
    assets = item.get("assets") or {}
    template = assets.get("asset_url_format") or ""
    capsule = assets.get("library_capsule_2x") or assets.get("library_capsule")
    hero = assets.get("library_hero_2x") or assets.get("library_hero")
    header = assets.get("header_2x") or assets.get("header")
    return {
        "capsule_image": asset_url(template, capsule),
        "hero_image": asset_url(template, hero),
        "header_image": asset_url(template, header),
    }


def descriptors_from_item(item: dict) -> list[int]:
    """Official Valve content descriptor ids for one store item, sorted."""
    raw = item.get("content_descriptorids")
    if not isinstance(raw, list):
        return []
    return sorted({value for value in raw if isinstance(value, int) and value > 0})


# Steam category ids for player support, as this endpoint reports them. Storing
# ids matters because the catalog's category text is localized ("JcJ" for PvP,
# "Un jugador" for Single-player), so any text matcher breaks per language.
PLAYER_CATEGORY_IDS = {1, 2, 9, 24, 27, 36, 38, 39, 48, 49}


def categories_from_item(item: dict) -> list[int]:
    """Player-support category ids, which is what the gameplay filters need.

    The same response also carries feature and controller ids; those do not feed
    the player filters, so they are not stored.
    """
    raw = item.get("categories")
    if not isinstance(raw, dict):
        return []
    values = raw.get("supported_player_categoryids")
    if not isinstance(values, list):
        return []
    return sorted({value for value in values if isinstance(value, int) and value in PLAYER_CATEGORY_IDS})


def is_adult_only(descriptor_ids: list[int] | None) -> bool:
    """Adult-only sexual content, per Valve's descriptors rather than user tags."""
    return bool(ADULT_ONLY_DESCRIPTORS.intersection(descriptor_ids or []))


def has_nudity_descriptor(descriptor_ids: list[int] | None) -> bool:
    """Some nudity or sexual content, which is separate from adult-only."""
    return bool(NUDITY_DESCRIPTORS.intersection(descriptor_ids or []))


class ArtworkResolver:
    """Batch resolver with a disk cache so repeats are free."""

    def __init__(self, client: httpx.Client, cache_dir: Path, delay: float = 1.0):
        self.client = client
        self.cache_dir = cache_dir
        self.delay = delay
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.last_request = 0.0
        self.requests = 0
        self.cache_hits = 0

    def _cache_path(self, app_ids: list[int]) -> Path:
        # The cache key carries a payload version so batches written before a
        # field existed are refetched instead of being read as "the API returned
        # nothing" for that field.
        key = hashlib.sha256(json.dumps([CACHE_VERSION, app_ids]).encode()).hexdigest()
        return self.cache_dir / (key + ".json")

    def _fetch(self, app_ids: list[int]) -> dict[int, dict[str, object]]:
        payload = {
            "ids": [{"appid": app_id} for app_id in app_ids],
            "context": {"language": "english", "country_code": "US"},
            "data_request": {"include_assets": True},
        }
        for attempt in range(4):
            time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            self.requests += 1
            response = self.client.get(STORE_API, params={"input_json": json.dumps(payload)})
            if response.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 5 * 2 ** attempt))
                continue
            response.raise_for_status()
            resolved: dict[int, dict[str, object]] = {}
            for item in response.json().get("response", {}).get("store_items", []):
                app_id = item.get("appid")
                if isinstance(app_id, int):
                    # Assets and the official age rating arrive in one response,
                    # so the catalog pays for a single request for both.
                    resolved[app_id] = {
                        **assets_from_item(item),
                        "content_descriptorids": descriptors_from_item(item),
                        "steam_category_ids": categories_from_item(item),
                    }
            return resolved
        # A failed batch must not abort the whole catalog: those games keep
        # whatever assets the seed already had.
        LOG.warning("Artwork batch of %s apps stayed unavailable after backoff", len(app_ids))
        return {}

    def resolve(self, app_ids: list[int], *, ttl: int = 30 * 86400) -> dict[int, dict[str, object]]:
        """Resolve many AppIDs, using and refreshing the disk cache."""
        result: dict[int, dict[str, object]] = {}
        for start in range(0, len(app_ids), BATCH_SIZE):
            batch = app_ids[start:start + BATCH_SIZE]
            path = self._cache_path(batch)
            if path.exists() and time.time() - path.stat().st_mtime < ttl:
                self.cache_hits += 1
                cached = json.loads(path.read_text(encoding="utf-8"))
                result.update({int(key): value for key, value in cached.items()})
                continue
            resolved = self._fetch(batch)
            # Only successful lookups are cached, so a transient failure is
            # retried on the next run instead of being remembered as empty.
            if resolved:
                next_path = path.with_suffix(".next")
                next_path.write_text(
                    json.dumps({str(k): v for k, v in resolved.items()}, ensure_ascii=False),
                    encoding="utf-8",
                )
                next_path.replace(path)
            result.update(resolved)
        return result


def apply_assets(games: dict, resolved: dict[int, dict[str, object]]) -> dict[str, int]:
    """Copy resolved URLs and official ratings onto the catalog records.

    An asset the API did not return for a game is left untouched rather than
    overwritten, so a partial API response never erases a known-good URL.
    """
    report = {"matched": 0, "capsule": 0, "hero": 0, "header": 0, "missing": 0,
              "descriptors": 0, "adult_only": 0, "nudity": 0, "categories": 0}
    for app_id, game in games.items():
        resolved_item = resolved.get(app_id)
        if resolved_item is None:
            report["missing"] += 1
            continue
        report["matched"] += 1
        for field in ("capsule_image", "hero_image", "header_image"):
            value = resolved_item.get(field)
            if isinstance(value, str) and value:
                game[field] = value
                report[field.replace("_image", "")] += 1
        # A cache written before descriptors and categories were collected has no
        # key here; in that case leave the record alone instead of overwriting
        # with nothing.
        if "content_descriptorids" in resolved_item:
            ids = resolved_item.get("content_descriptorids")
            ids = sorted(ids) if isinstance(ids, list) else []
            game["content_descriptorids"] = ids
            game["adult_only"] = is_adult_only(ids)
            if ids:
                report["descriptors"] += 1
            if game["adult_only"]:
                report["adult_only"] += 1
            if has_nudity_descriptor(ids):
                report["nudity"] += 1
        if "steam_category_ids" in resolved_item:
            categories = resolved_item.get("steam_category_ids")
            categories = sorted(categories) if isinstance(categories, list) else []
            game["steam_category_ids"] = categories
            if categories:
                report["categories"] += 1
    return report
