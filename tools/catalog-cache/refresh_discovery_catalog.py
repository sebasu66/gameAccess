#!/usr/bin/env python
"""Build the shared discovery database; never collect game download links.
Steam Store search is paginated, newest releases first. Only a completed traversal
to the rolling date boundary can be published. Local caches make retries cheap.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import html
from html.parser import HTMLParser
import json
import logging
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

import httpx
from build_catalog_snapshot import OUTPUT_DIR, stable_json, steam_assets, write_snapshot

LOG = logging.getLogger("gameaccess.discovery")
STORE = "https://store.steampowered.com"
COOPTIMUS = "https://api.co-optimus.com/games.php"
CACHE = Path(__file__).resolve().parents[2] / "apps/api/.cache/discovery"


def release_date(value: str) -> date | None:
    for fmt in ("%b %d, %Y", "%d %b, %Y", "%d %B, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            pass
    return None


class SearchParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.stack = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if tag == "a" and "search_result_row" in classes:
            app_id = attrs.get("data-ds-appid", "")
            # Packages, bundles and ambiguous multi-AppID rows are not games.
            if not app_id.isdigit() or not re.search(r"/app/" + app_id + r"/", attrs.get("href", "")):
                self.row = None
                return
            self.row = {"app_id": int(app_id), "name": "", "release_date": "",
                        "tag_ids": json.loads(attrs.get("data-ds-tagids", "[]")),
                        "platforms": [], "review_count": None, "review_score": None}
            self.stack = []
        if self.row is None:
            return
        if tag not in ("img", "br", "input", "meta", "link"):
            self.stack.append((tag, classes))
        if "platform_img" in classes:
            self.row["platforms"].extend(c for c in classes if c in ("win", "mac", "linux"))
        tooltip = html.unescape(attrs.get("data-tooltip-html", ""))
        review = re.search(r"(\d+)% of the ([\d,]+) user reviews", tooltip)
        if review:
            self.row["review_score"] = int(review.group(1))
            self.row["review_count"] = int(review.group(2).replace(",", ""))

    def handle_data(self, value):
        if self.row is None:
            return
        classes = {c for _, names in self.stack for c in names}
        if "title" in classes:
            self.row["name"] += value
        if "search_released" in classes:
            self.row["release_date"] += value

    def handle_endtag(self, tag):
        if self.row is None:
            return
        if tag == "a":
            self.row["name"] = self.row["name"].strip()
            self.row["release_date"] = self.row["release_date"].strip()
            self.rows.append(self.row)
            self.row = None
        elif any(entry[0] == tag for entry in self.stack):
            while self.stack:
                entry = self.stack.pop()
                if entry[0] == tag:
                    break


def parse_search(payload: dict) -> list[dict]:
    if payload.get("success") != 1 or not isinstance(payload.get("results_html"), str):
        raise ValueError("Steam search returned an invalid page")
    parser = SearchParser()
    parser.feed(payload["results_html"])
    return parser.rows


class Remote:
    def __init__(self, client, cache_dir: Path, delay: float):
        self.client, self.cache_dir, self.delay = client, cache_dir, delay
        cache_dir.mkdir(parents=True, exist_ok=True)
        self.last_request = 0.0

    def get(self, url: str, params: dict | None = None, ttl: int = 3600, as_json: bool = True):
        key = hashlib.sha256(stable_json([url, params]).encode()).hexdigest()
        path = self.cache_dir / (key + ".json")
        if path.exists() and time.time() - path.stat().st_mtime < ttl:
            return json.loads(path.read_text(encoding="utf-8"))
        for attempt in range(4):
            time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            response = self.client.get(url, params=params)
            if response.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 5 * 2 ** attempt))
                continue
            response.raise_for_status()
            result = response.json() if as_json else response.text
            # No error response is cached or allowed into a published snapshot.
            next_path = path.with_suffix(".next")
            next_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
            next_path.replace(path)
            return result
        raise RuntimeError("Metadata service remained unavailable after backoff")


def discover(remote, cutoff: date, today: date, *, popular_limit: int = 5000):
    rows = {}
    report = {"released_since": cutoff.isoformat(), "through": today.isoformat(),
              "recent_complete": False, "recent_count": 0, "popular_limit": popular_limit,
              "source": STORE + "/search/?sort_by=Released_DESC&category1=998&ignore_preferences=1"}
    for sort, limit in (("Released_DESC", None), ("Reviews_DESC", popular_limit)):
        start = 0
        recent_ids = set()
        while limit is None or start < limit:
            page = remote.get(STORE + "/search/results/", {
                "query": "", "start": start, "count": 100,
                "sort_by": sort, "category1": 998, "ignore_preferences": 1,
                "infinite": 1, "l": "english", "cc": "us", "supportedlang": "",
            })
            parsed = parse_search(page)
            total = int(page.get("total_count", 0))
            # Empty/unparseable intermediate pages mean incomplete coverage.
            if not parsed and start < total:
                raise ValueError(f"Steam returned no game rows at offset {start}")
            boundary = False
            for row in parsed:
                released = release_date(row["release_date"])
                if sort == "Released_DESC":
                    if released and released < cutoff:
                        boundary = True
                        continue
                    if released and cutoff <= released <= today:
                        rows[row["app_id"]] = row
                        recent_ids.add(row["app_id"])
                elif not released or released <= today:
                    rows.setdefault(row["app_id"], row)
            start += 100
            LOG.info("Steam %s offset=%s total=%s collected=%s", sort, start, total, len(rows))
            if boundary or start >= total:
                if sort == "Released_DESC":
                    report["recent_complete"] = True
                    report["recent_count"] = len(recent_ids)
                break
            if start >= 200000:
                raise ValueError("Steam traversal exceeded the safety limit; refusing incomplete publication")
        if sort == "Released_DESC" and not report["recent_complete"]:
            raise ValueError("Recent-release discovery was incomplete")
    return list(rows.values()), report


def load_seed(directory: Path):
    manifest = json.loads((directory / "catalog-manifest.json").read_text(encoding="utf-8"))
    compressed = (directory / f"catalog-cache-{manifest['revision']}.sqlite.gz").read_bytes()
    if hashlib.sha256(compressed).hexdigest() != manifest["sha256"]:
        raise ValueError("Seed catalog hash mismatch")
    db = sqlite3.connect(":memory:")
    db.deserialize(gzip.decompress(compressed))
    games = {json.loads(payload)["app_id"]: json.loads(payload)
             for (payload,) in db.execute("SELECT payload FROM catalog_game") if json.loads(payload).get("app_id")}
    details = {(int(gid), lang, country): payload for gid, lang, country, payload in
               db.execute("SELECT game_id,language,country,payload FROM game_detail")}
    db.close()
    return games, details


def merge_search(games: dict, rows: list[dict], tag_names: dict):
    next_id = max((g["id"] for g in games.values()), default=0) + 1
    for row in rows:
        app_id = row["app_id"]
        game = games.get(app_id)
        if game is None:
            game = {"id": next_id, "app_id": app_id, "slug": f"steam-{app_id}",
                    "credit_cost_per_hour": 0, "copies_total": 0, "copies_available": 0,
                    "genres": [], "categories": [], "tags": [], "developers": [], "publishers": [],
                    "short_description": "", **steam_assets(app_id)}
            next_id += 1
            games[app_id] = game
        game["name"] = row["name"]
        released = release_date(row["release_date"])
        if released:
            game["release_date"] = released.isoformat()
        for field, value in (("steam_review_score", row["review_score"]), ("steam_review_count", row["review_count"])):
            if value is not None:
                game[field] = value
        tags = [tag_names[int(tag)] for tag in row["tag_ids"] if int(tag) in tag_names]
        game["tags"] = sorted(set(game.get("tags", [])) | set(tags))
        game["steam_tag_ids"] = row["tag_ids"]
        game["tag_sources"] = {**game.get("tag_sources", {}), "steam-store": tags}
        game["metadata_sources"] = sorted(set(game.get("metadata_sources", [])) | {"steam-store"})
        game["metadata_state"] = game.get("metadata_state") or "discovered"
        game["platforms"] = row["platforms"]
        # Positive community tags are useful hints; missing tags aren't false.
        positive = {"Singleplayer": "single_player", "Multiplayer": "multiplayer",
                    "Co-op": "coop", "Online Co-Op": "online_coop",
                    "Local Co-Op": "local_coop", "Split Screen": "shared_split_screen",
                    "Massively Multiplayer": "mmo", "PvP": "pvp"}
        for tag, field in positive.items():
            if tag in tags and game.get(field) is None:
                game[field] = True


def cooptimus_features(raw: str, app_id: int) -> dict | None:
    """Accept XML with an exact Steam ID; never join by a fuzzy game name."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None
    for element in root.iter("game"):
        fields = {child.tag.casefold(): (child.text or "").strip() for child in element}
        steam = fields.get("steam") or fields.get("steamid") or fields.get("steam_id")
        if steam != str(app_id):
            continue
        result = {}
        for source, target in (("local", "local_players_max"), ("online", "online_players_max")):
            value = fields.get(source, "")
            if value.isdigit() and 0 <= int(value) <= 256:
                result[target] = int(value)
        if result:
            return result
    return None


def enrich_cooptimus(remote, games: dict, limit: int):
    report = {"processed": 0, "matched": 0, "state": "not-requested"}
    candidates = [g for g in games.values() if g.get("coop") and not g.get("players_source")]
    for game in sorted(candidates, key=lambda g: g.get("steam_review_count") or 0, reverse=True)[:limit]:
        try:
            raw = remote.get(COOPTIMUS, {"search": "true", "steam": game["app_id"]},
                             ttl=30 * 86400, as_json=False)
        except httpx.HTTPStatusError as exc:
            report["state"] = f"http-{exc.response.status_code}"
            LOG.warning("Co-Optimus unavailable: HTTP %s; preserving existing metadata", exc.response.status_code)
            break
        report["processed"] += 1
        features = cooptimus_features(raw, game["app_id"])
        if features:
            apply_enrichment(game, {"source": "co-optimus", "source_url": COOPTIMUS, **features})
            report["matched"] += 1
            report["state"] = "ok"
        else:
            report["state"] = "no-verified-match"
    return report


def apply_enrichment(game: dict, row: dict):
    source = row.get("source")
    if source not in ("co-optimus", "pcgamingwiki", "steamspy"):
        raise ValueError("Unsupported enrichment source")
    tags = [str(tag).strip() for tag in row.get("tags", []) if str(tag).strip()]
    game["tags"] = sorted(set(game.get("tags", [])) | set(tags))
    game["tag_sources"] = {**game.get("tag_sources", {}), source: tags}
    game["metadata_sources"] = sorted(set(game.get("metadata_sources", [])) | {source}
    for field in ("min_players", "max_players", "local_players_max", "online_players_max"):
        value = row.get(field)
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 256:
            game[field] = value
            game["players_source"] = source
    local, online = row.get("local_players_max"), row.get("online_players_max")
    if isinstance(local, int) and local > 1:
        game["local_coop"] = game["coop"] = True
        tags.append(f"Couch co-op: {local} players")
    if isinstance(online, int) and online > 1:
        game["online_coop"] = game["coop"] = True
        tags.append(f"Online co-op: {online} players")
    game["tags"] = sorted(set(game["tags"]) | set(tags))
    game["tag_sources"][source] = tags
    if row.get("source_url"):
        game["metadata_urls"] = {**game.get("metadata_urls", {}), source: row["source_url"]}


def refresh(args):
    games, details = load_seed(args.seed_dir)
    today = date.fromisoformat(args.as_of) if args.as_of else datetime.now(timezone.utc).date()
    with httpx.Client(timeout=40, follow_redirects=True, headers={
        "User-Agent": "GameAccess/1.0 discovery catalog (metadata only)",
    }) as client:
        remote = Remote(client, args.cache_dir, args.delay)
        names = {int(t["tagid"]): t["name"] for t in remote.get(STORE + "/tagdata/populartags/english", ttl=86400)}
        rows, report = discover(remote, today - timedelta(days=args.days), today, popular_limit=args.popular_limit)
        merge_search(games, rows, names)
        report["cooptimus"] = enrich_cooptimus(remote, games, args.cooptimus_limit)
    if args.enrichment_file:
        for row in json.loads(args.enrichment_file.read_text(encoding="utf-8")):
            # Exact canonical Steam identity, never title similarity.
            game = games.get(row.get("app_id"))
            if game:
                apply_enrichment(game, row)
    report["updated_at"] = datetime.now(timezone.utc).isoformat()
    report["tagged_count"] = sum(bool(g.get("tags")) for g in games.values())
    catalog = [(g["id"], app_id, stable_json(g)) for app_id, g in sorted(games.items())]
    result = write_snapshot(catalog, details, args.output_dir, args.github_ref, report)
    # Keep only the manifest's snapshot so installers do not carry every revision.
    for old in args.output_dir.glob("catalog-cache-*.sqlite.gz"):
        if old != result[0]:
            old.unlink()
    (args.output_dir / "discovery-coverage.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    LOG.info("Published discovery catalog: games=%s tagged=%s recent=%s", len(games), report["tagged_count"], report["recent_count"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--cache-dir", type=Path, default=CACHE)
    parser.add_argument("--github-ref", default="dev")
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--as-of")
    parser.add_argument("--popular-limit", type=int, default=5000)
    parser.add_argument("--cooptimus-limit", type=int, default=20)
    parser.add_argument("--enrichment-file", type=Path)
    parser.add_argument("--delay", type=float, default=1.1)
    args = parser.parse_args()
    if args.days < 365 or args.delay < 1:
        parser.error("Discovery must cover at least 365 days with a polite request delay >= 1 second")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    refresh(args)


if __name__ == "__main__":
    main()
