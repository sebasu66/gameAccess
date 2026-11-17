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

The same request also carries the review summary, weighted tags, release date,
platforms and temporary free offers, so the daily catalog job gets them for every
game in one pass and the central server never asks Steam for reviews. Measured on
1,000 catalog games: scores differ from Steam's own review endpoint by a median of
0.5 points.

It also names the developers, publishers and franchise, whether the game has Spanish
(interface, subtitles, full audio), the official minimum age, Steam Deck compatibility
and controller support. Asking for those made a 100-game batch 0.93 s instead of
0.88 s and 381 KB instead of 276 KB (measured 2026-11-04).
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

LOG = logging.getLogger("gameaccess.artwork")

STORE_API = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
ASSET_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/"
USER_AGENT = "GameAccess/1.0 discovery catalog (metadata only)"
# The endpoint accepts a batch of ids per call: 200 answer in under a second, 300
# are refused with HTTP 400 (measured 2026-11-04); 100 leaves room in the query string.
BATCH_SIZE = 100
# Bump when the resolved payload gains a field. The cache key includes it so
# batches written before a field existed are refetched rather than misread as
# "the API returned nothing" for that field.
CACHE_VERSION = 4
# Steam returns tags by weight; the first 20 are the ones its own store shows.
TAG_COUNT = 20

# Steam's ELanguage: Spanish (Spain) and Latin American Spanish.
SPANISH_LANGUAGES = {5: "es", 27: "latam"}
# Steam category ids for controllers: 28 = full controller support, 18 = partial.
CONTROLLER_SUPPORT = ((28, "full"), (18, "partial"))
# Steam Deck compatibility categories: 1 unsupported, 2 playable, 3 verified (0 = not tested).
STEAM_DECK = {1: "unsupported", 2: "playable", 3: "verified"}

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


def reviews_from_item(item: dict) -> dict[str, int]:
    """Review count and percent positive; a game without reviews has no score."""
    summary = (item.get("reviews") or {}).get("summary_filtered")
    if not isinstance(summary, dict):
        return {}
    count, score = summary.get("review_count"), summary.get("percent_positive")
    result = {}
    if isinstance(count, int) and count >= 0:
        result["steam_review_count"] = count
        if count and isinstance(score, int) and 0 <= score <= 100:
            result["steam_review_score"] = score
    return result


def tags_from_item(item: dict) -> list[int]:
    """Tag ids, heaviest first, so the order says what the game mostly is."""
    tags = item.get("tags")
    if isinstance(tags, list) and tags:
        weighted = [t for t in tags if isinstance(t, dict) and isinstance(t.get("tagid"), int)]
        return [t["tagid"] for t in sorted(weighted, key=lambda t: -int(t.get("weight") or 0))]
    ids = item.get("tagids")
    return [value for value in ids if isinstance(value, int)] if isinstance(ids, list) else []


def release_from_item(item: dict) -> str | None:
    """Release day; games still coming soon have none."""
    stamp = (item.get("release") or {}).get("steam_release_date")
    if not isinstance(stamp, int) or stamp <= 0:
        return None
    return datetime.fromtimestamp(stamp, tz=timezone.utc).date().isoformat()


def platforms_from_item(item: dict) -> list[str] | None:
    platforms = item.get("platforms")
    if not isinstance(platforms, dict):
        return None
    return [name for name, key in (("win", "windows"), ("mac", "mac"), ("linux", "steamos_linux")) if platforms.get(key)]


def free_promo_from_item(item: dict) -> dict | None:
    """A paid game Steam gives away for a while: free weekend or free to keep.

    Times are Unix seconds. Free-to-play games are not promotions and return None.
    """
    weekend = item.get("free_weekend")
    if isinstance(weekend, dict) and isinstance(weekend.get("end_time"), int):
        return {"kind": "free_weekend", "starts_at": weekend.get("start_time"), "ends_at": weekend["end_time"]}
    option = item.get("best_purchase_option")
    if isinstance(option, dict) and option.get("is_free_to_keep"):
        ends = option.get("free_to_keep_ends") or max(
            (d.get("discount_end_date") or 0 for d in option.get("active_discounts") or [] if isinstance(d, dict)), default=0)
        return {"kind": "free_to_keep", "ends_at": ends or None}
    if item.get("is_free_temporarily"):
        return {"kind": "free_temporarily", "ends_at": None}
    return None


def credits_from_item(item: dict) -> dict[str, list[str]]:
    """Developers, publishers and franchises by name; a list the API did not send is left out."""
    info = item.get("basic_info")
    if not isinstance(info, dict):
        return {}
    result = {}
    for field in ("developers", "publishers", "franchises"):
        names = [entry.get("name").strip() for entry in info.get(field) or []
                 if isinstance(entry, dict) and isinstance(entry.get("name"), str) and entry.get("name").strip()]
        if names:
            result[field] = list(dict.fromkeys(names))
    return result


def spanish_from_item(item: dict) -> dict | None:
    """Whether the game has Spanish and how far: interface, subtitles, full audio, and if it is Latin American."""
    found = {}
    for entry in item.get("supported_languages") or []:
        if isinstance(entry, dict) and entry.get("supported") and entry.get("elanguage") in SPANISH_LANGUAGES:
            found[SPANISH_LANGUAGES[entry["elanguage"]]] = entry
    if not found:
        return None
    return {"interface": True, "subtitles": any(bool(e.get("subtitles")) for e in found.values()),
            "audio": any(bool(e.get("full_audio")) for e in found.values()), "latam": "latam" in found}


def required_age_from_item(item: dict) -> int | None:
    age = (item.get("game_rating") or {}).get("required_age")
    return age if isinstance(age, int) and age > 0 else None


def steam_deck_from_item(item: dict) -> str | None:
    return STEAM_DECK.get((item.get("platforms") or {}).get("steam_deck_compat_category"))


def controller_from_item(item: dict) -> str | None:
    ids = (item.get("categories") or {}).get("controller_categoryids") or []
    return next((level for category, level in CONTROLLER_SUPPORT if category in ids), None)


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
            "data_request": {"include_assets": True, "include_reviews": True, "include_tag_count": TAG_COUNT,
                             "include_release": True, "include_platforms": True, "include_basic_info": True,
                             "include_supported_languages": True, "include_ratings": True},
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
                        **reviews_from_item(item),
                        "content_descriptorids": descriptors_from_item(item),
                        "steam_category_ids": categories_from_item(item),
                        "steam_tag_ids": tags_from_item(item),
                        "release_date": release_from_item(item),
                        "platforms": platforms_from_item(item),
                        "steam_free_promo": free_promo_from_item(item),
                        "credits": credits_from_item(item),
                        "spanish": spanish_from_item(item),
                        "required_age": required_age_from_item(item),
                        "steam_deck": steam_deck_from_item(item),
                        "controller_support": controller_from_item(item),
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


def apply_assets(games: dict, resolved: dict[int, dict[str, object]], tag_names: dict[int, str] | None = None) -> dict[str, int]:
    """Copy resolved URLs, official ratings, reviews and tags onto the catalog records.

    An asset the API did not return for a game is left untouched rather than
    overwritten, so a partial API response never erases a known-good URL.
    """
    report = {"matched": 0, "capsule": 0, "hero": 0, "header": 0, "missing": 0,
              "descriptors": 0, "adult_only": 0, "nudity": 0, "categories": 0,
              "reviews": 0, "tags": 0, "free_promos": 0, "developers": 0, "franchises": 0, "spanish": 0,
              "required_age": 0, "steam_deck": 0, "controller": 0}
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
        if "steam_review_count" in resolved_item:
            game["steam_review_count"] = resolved_item["steam_review_count"]
            if "steam_review_score" in resolved_item:
                game["steam_review_score"] = resolved_item["steam_review_score"]
                report["reviews"] += 1
        tag_ids = resolved_item.get("steam_tag_ids")
        if tag_ids:
            game["steam_tag_ids"] = tag_ids
            report["tags"] += 1
            if tag_names:
                # Replace this source's previous tags, keep the ones other sources gave.
                names = [tag_names[t] for t in tag_ids if t in tag_names]
                previous = set(game.get("tag_sources", {}).get("steam-store", []))
                game["tags"] = sorted((set(game.get("tags", [])) - previous) | set(names))
                game["tag_sources"] = {**game.get("tag_sources", {}), "steam-store": names}
        for field in ("release_date", "platforms"):
            if resolved_item.get(field) is not None:
                game[field] = resolved_item[field]
        for field, value in (resolved_item.get("credits") or {}).items():
            game[field] = value
        report["developers"] += bool((resolved_item.get("credits") or {}).get("developers"))
        report["franchises"] += bool((resolved_item.get("credits") or {}).get("franchises"))
        # These say what Steam says today: an answer without them (Spanish dropped, say) clears the old value.
        for field, counter in (("spanish", "spanish"), ("required_age", "required_age"), ("steam_deck", "steam_deck"),
                               ("controller_support", "controller")):
            if field not in resolved_item:
                continue
            if resolved_item[field] is None:
                game.pop(field, None)
            else:
                game[field] = resolved_item[field]
                report[counter] += 1
        # Present but empty means the offer ended, so the flag goes away.
        if "steam_free_promo" in resolved_item:
            promo = resolved_item["steam_free_promo"]
            if promo:
                game["steam_free_promo"] = promo
                report["free_promos"] += 1
            else:
                game.pop("steam_free_promo", None)
    return report
