#!/usr/bin/env python
"""Enrich the existing discovery catalog without re-crawling the Store search.

The search crawl is the part that gets throttled: it needs ~1300 paginated
requests and Steam answered 429 at offset 6000 of 132160. The store item API is
a different budget entirely — 41729 games resolve in ~835 batched requests — and
it is the source of the fields the catalog is actually missing:

  * real hashed artwork URLs (the derived paths answer 404 for ~56% of games)
  * Valve's official content descriptors, for parental control
  * player-support category ids, which the gameplay filters need

Nothing about names, dates or reviews changes here, so the search crawl is not
needed. The resolver caches each batch on disk, so a second run is nearly free.
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))

import httpx  # noqa: E402
from app.catalog_artwork import ArtworkResolver, apply_assets  # noqa: E402
from app.catalog_snapshot import stable_json, write_snapshot  # noqa: E402

OUTPUT_DIR = REPO_ROOT / "deploy" / "catalog-cache"
LOG = logging.getLogger("gameaccess.enrich")


def newest_seed(directory: Path) -> Path:
    seeds = sorted(directory.glob("catalog-cache-*.sqlite.gz"), key=lambda p: p.stat().st_mtime)
    if not seeds:
        raise SystemExit(f"No discovery seed found in {directory}")
    return seeds[-1]


def richest_seed(directories: list[Path]) -> Path:
    """Pick the seed that carries the most category records.

    Not simply the newest file: the server's maintenance rebuilds its snapshot
    from the discovery seed, and that rebuild produces a catalog with category
    data for under 1% of games. Choosing by recency would therefore pick the
    poorer catalog and chain that loss forward into every later package.
    """
    best: tuple[int, Path] | None = None
    for directory in directories:
        if not directory.is_dir():
            continue
        for candidate in directory.glob("catalog-cache-*.sqlite.gz"):
            try:
                games, _ = load_seed(candidate)
            except (sqlite3.Error, OSError) as error:
                LOG.warning("Skipping unreadable seed %s: %s", candidate.name, error)
                continue
            score = sum(1 for game in games.values() if game.get("categories"))
            LOG.info("Seed %s carries %s games with categories", candidate.name, score)
            if best is None or score > best[0]:
                best = (score, candidate)
    if best is None:
        raise SystemExit("No readable discovery seed found in " + ", ".join(str(d) for d in directories))
    return best[1]


def load_seed(path: Path) -> tuple[dict[int, dict], dict[tuple[int, str, str], str]]:
    db = sqlite3.connect(":memory:")
    db.deserialize(__import__("gzip").decompress(path.read_bytes()))
    games: dict[int, dict] = {}
    for (payload,) in db.execute("SELECT payload FROM catalog_game"):
        game = json.loads(payload)
        app_id = game.get("app_id")
        if app_id:
            games[int(app_id)] = game
    details = {
        (int(gid), lang, country): payload
        for gid, lang, country, payload in db.execute(
            "SELECT game_id,language,country,payload FROM game_detail"
        )
    }
    db.close()
    return games, details


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--seed-dirs", type=Path, nargs="*",
                        default=[REPO_ROOT / "apps" / "api" / ".cache" / "discovery-catalog"],
                        help="Additional directories to consider; the richest seed wins.")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--cache-dir", type=Path, default=REPO_ROOT / ".cache" / "catalog-artwork")
    parser.add_argument("--github-ref", default="dev")
    parser.add_argument("--delay", type=float, default=1.1)
    parser.add_argument("--limit", type=int, default=0, help="Only enrich the first N games (smoke test).")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    seed = richest_seed([args.seed_dir, *args.seed_dirs])
    LOG.info("Reading seed %s", seed.name)
    games, details = load_seed(seed)
    LOG.info("Loaded %s games and %s detail rows", len(games), len(details))

    app_ids = sorted(games)
    if args.limit:
        app_ids = app_ids[: args.limit]
        LOG.info("Limiting to %s games", len(app_ids))

    with httpx.Client(timeout=40, follow_redirects=True,
                      headers={"User-Agent": "GameAccess/1.0 discovery catalog (metadata only)"}) as client:
        resolver = ArtworkResolver(client, args.cache_dir, delay=args.delay)
        resolved = resolver.resolve(app_ids)
        report = apply_assets(games, resolved)
        report["requests"] = resolver.requests
        report["cache_hits"] = resolver.cache_hits

    LOG.info(
        "Enriched: matched=%s capsule=%s hero=%s header=%s missing=%s descriptors=%s "
        "adult_only=%s nudity=%s category_ids=%s requests=%s cache_hits=%s",
        report["matched"], report["capsule"], report["hero"], report["header"], report["missing"],
        report["descriptors"], report["adult_only"], report["nudity"], report["categories"],
        report["requests"], report["cache_hits"],
    )

    manifest_path = args.seed_dir / "catalog-manifest.json"
    if manifest_path.exists():
        coverage = json.loads(manifest_path.read_text(encoding="utf-8")).get("coverage")
    else:
        coverage = None
    if coverage is not None:
        coverage = {**coverage, "artwork": report}

    catalog = [(game["id"], app_id, stable_json(game)) for app_id, game in sorted(games.items())]
    artifact, manifest = write_snapshot(catalog, details, args.output_dir, args.github_ref, coverage)
    LOG.info("Published %s and %s", artifact.name, manifest.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
