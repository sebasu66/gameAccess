#!/usr/bin/env python
"""Fill the discovery catalog from a local SteamDB-format dump.

Why this exists: the Store search crawl is the part Steam throttles (it answered
429 at offset 6000 of 132160), and the fields the gameplay and content filters
need are not in our catalog anyway — `categories` covers 673 of 41729 games, and
`steam_category_ids` is empty everywhere. A published dump carries those fields
for essentially every game, so the catalog can be filled without thousands of
rate-limited requests.

The dump is read locally, its fields are copied into our own catalog format, and
the file is expected to be deleted afterwards. Only factual metadata is taken:
player categories, community tags and review aggregates. The dump itself is never
committed or redistributed.

Reads the dump incrementally, because the decompressed array is ~350 MB and
loading it whole would need gigabytes of RAM. No third-party parser is used: the
standard library's incremental decoder is enough and adds no dependency.
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))

from app.catalog_snapshot import stable_json, write_snapshot  # noqa: E402

OUTPUT_DIR = REPO_ROOT / "deploy" / "catalog-cache"
DEFAULT_DUMP = REPO_ROOT / ".cache" / "steamdb" / "steamdb.min.json.gz"
LOG = logging.getLogger("gameaccess.steamdb")

# Player-support categories as Steam's store names them. Kept as text because
# that is what the catalog already stores and what the matcher reads.
PLAYER_CATEGORIES = {
    "multi-player", "single-player", "co-op", "shared/split screen",
    "cross-platform multiplayer", "online pvp", "online co-op",
    "shared/split screen co-op", "lan co-op", "pvp",
}
# Cap the community tags per game: the panel only ever shows a bounded list, and
# an unbounded array would bloat every delta update.
MAX_TAGS = 40


def newest_seed(directory: Path) -> Path:
    seeds = sorted(directory.glob("catalog-cache-*.sqlite.gz"), key=lambda p: p.stat().st_mtime)
    if not seeds:
        raise SystemExit(f"No discovery seed found in {directory}")
    return seeds[-1]


def load_seed(path: Path) -> tuple[dict[int, dict], dict[tuple[int, str, str], str]]:
    db = sqlite3.connect(":memory:")
    db.deserialize(gzip.decompress(path.read_bytes()))
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


def iter_records(path: Path):
    """Yield one dump record at a time without holding the whole array."""
    decoder = json.JSONDecoder()
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        buffer = ""
        # Skip the opening bracket and any whitespace.
        chunk = handle.read(1 << 20)
        while chunk and chunk.lstrip().startswith("["):
            chunk = chunk.lstrip()[1:]
        buffer = chunk
        while True:
            buffer = buffer.lstrip()
            while buffer.startswith(","):
                buffer = buffer[1:].lstrip()
            if buffer.startswith("]") or not buffer:
                more = handle.read(1 << 20)
                if not more:
                    return
                buffer += more
                continue
            try:
                record, end = decoder.raw_decode(buffer)
            except ValueError:
                more = handle.read(1 << 20)
                if not more:
                    return
                buffer += more
                continue
            yield record
            buffer = buffer[end:]


def player_categories(values) -> list[str]:
    if not isinstance(values, list):
        return []
    return [value for value in values
            if isinstance(value, str) and value.strip().lower() in PLAYER_CATEGORIES]


def apply_record(game: dict, record: dict, report: dict) -> None:
    categories = player_categories(record.get("categories"))
    if categories:
        game["categories"] = categories
        report["categories"] += 1

    # Steam's own genre list, English and stable, unlike the translated 2019
    # SteamSpy values this field used to hold. That legacy data covered 674 games
    # and mixed in content tags ("Desnudos", "Violencia"), which made the genre
    # filter match games Steam does not classify that way.
    genres = [genre for genre in (record.get("genres") or []) if isinstance(genre, str) and genre.strip()]
    if genres:
        game["genres"] = genres
        report["genres"] += 1

    tags = [tag for tag in (record.get("tags") or []) if isinstance(tag, str)]
    if tags:
        game["tags"] = tags[:MAX_TAGS]
        report["tags"] += 1

    score = record.get("steam_reviews_percent")
    if isinstance(score, (int, float)):
        game["steam_review_score"] = float(score)
        report["review_score"] += 1
    count = record.get("steam_reviews_count")
    if isinstance(count, int):
        game["steam_review_count"] = count
        report["review_count"] += 1


def category_coverage(games: dict[int, dict]) -> int:
    return sum(1 for game in games.values() if game.get("categories"))


def regression_guard(games: dict[int, dict], output_dir: Path, allow: bool) -> None:
    """Refuse to publish a catalog that carries fewer category records than the
    one already published.

    This is the failure that actually bit us: the server's maintenance rebuilds
    the snapshot from the discovery seed, and that seed holds category data for
    under 1% of games. A rebuild therefore silently replaced a filled catalog
    with an empty one. Filling from a dump is pointless if the next rebuild
    throws it away, so the drop is detected and reported instead of published.
    """
    manifest = output_dir / "catalog-manifest.json"
    if not manifest.exists():
        return
    previous = json.loads(manifest.read_text(encoding="utf-8")).get("coverage", {}).get("steamdb")
    if not previous:
        return
    before = int(previous.get("categories") or 0)
    now = category_coverage(games)
    if now >= before:
        return
    message = (
        f"Refusing to publish: category records would drop from {before} to {now}. "
        "The seed this run started from is thinner than the published catalog, which means "
        "the server rebuilt it from the discovery seed. Re-run against the published catalog "
        "or pass --allow-coverage-drop to override."
    )
    if allow:
        LOG.warning(message)
        return
    raise SystemExit(message)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dump", type=Path, default=DEFAULT_DUMP)
    parser.add_argument("--seed-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--github-ref", default="dev")
    parser.add_argument("--delete-dump", action="store_true",
                        help="Remove the dump after a successful publication.")
    parser.add_argument("--allow-coverage-drop", action="store_true",
                        help="Publish even when category records would decrease.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not args.dump.is_file():
        raise SystemExit(f"Dump not found: {args.dump}")

    seed = newest_seed(args.seed_dir)
    LOG.info("Reading seed %s", seed.name)
    games, details = load_seed(seed)
    LOG.info("Loaded %s games and %s detail rows", len(games), len(details))

    report = {"seen": 0, "matched": 0, "categories": 0, "genres": 0, "tags": 0,
              "review_score": 0, "review_count": 0}
    for record in iter_records(args.dump):
        report["seen"] += 1
        app_id = record.get("steam_appid")
        if not isinstance(app_id, int):
            continue
        game = games.get(app_id)
        if game is None:
            continue
        report["matched"] += 1
        apply_record(game, record, report)
        if report["seen"] % 50000 == 0:
            LOG.info("Scanned %s records; matched %s", report["seen"], report["matched"])

    LOG.info(
        "Filled from dump: seen=%s matched=%s categories=%s genres=%s tags=%s review_score=%s review_count=%s",
        report["seen"], report["matched"], report["categories"], report["genres"], report["tags"],
        report["review_score"], report["review_count"],
    )

    manifest_path = args.seed_dir / "catalog-manifest.json"
    coverage = None
    if manifest_path.exists():
        coverage = json.loads(manifest_path.read_text(encoding="utf-8")).get("coverage")
    if coverage is not None:
        coverage = {**coverage, "steamdb": report}

    regression_guard(games, args.output_dir, args.allow_coverage_drop)

    catalog = [(game["id"], app_id, stable_json(game)) for app_id, game in sorted(games.items())]
    artifact, manifest = write_snapshot(catalog, details, args.output_dir, args.github_ref, coverage)
    LOG.info("Published %s and %s", artifact.name, manifest.name)

    if args.delete_dump:
        try:
            args.dump.unlink()
            LOG.info("Deleted the local dump as requested")
        except OSError as error:
            LOG.warning("Could not delete the dump: %s", error)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
