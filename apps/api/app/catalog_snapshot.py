from __future__ import annotations
import gzip
import hashlib
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

from .genre_normalization import normalize_catalog_rows

LOG = logging.getLogger("gameaccess.catalog_snapshot")

def steam_assets(app_id: int | None) -> dict[str, str | None]:
    """Identity fields only.

    Artwork is deliberately absent: Steam serves covers from hashed paths that
    cannot be derived from an AppID, and a guessed URL answers 404 for most of
    the catalog. Real asset URLs are resolved from the store API in
    `catalog_artwork` before the snapshot is published. A missing URL here means
    "not resolved yet", which the client renders as a placeholder instead of
    firing requests that are known to fail.
    """
    if not app_id:
        return {
            "header_image": None,
            "capsule_image": None,
            "hero_image": None,
            "steam_url": None,
        }
    return {
        "header_image": None,
        "capsule_image": None,
        "hero_image": None,
        "steam_url": f"https://store.steampowered.com/app/{app_id}/",
    }


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def write_snapshot(catalog_rows: list[tuple[int, int | None, str]], detail_rows: dict[tuple[int, str, str], str], output_dir: Path, github_ref: str, coverage: dict | None = None, strip_normalized: bool = True) -> tuple[Path, Path]:
    """Publish metadata only; consumers validate hash, schema and row count.

    ``strip_normalized`` drops the tables that duplicate the ``catalog_game``
    payload. Every reader rebuilds them from the payload, so keeping them would
    only inflate the installer package by roughly 14 MB compressed.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    # Genres are normalized before hashing so the revision describes what ships.
    catalog_rows = normalize_catalog_rows(catalog_rows)
    from datetime import datetime, timezone
    generated_at = datetime.now(timezone.utc).isoformat()
    content_hasher = hashlib.sha256()
    for _, _, payload in sorted(catalog_rows):
        content_hasher.update(payload.encode("utf-8"))
    for key, payload in sorted(detail_rows.items()):
        content_hasher.update(stable_json(key).encode("utf-8"))
        content_hasher.update(payload.encode("utf-8"))
    revision = content_hasher.hexdigest()[:16]
    existing_manifest = output_dir / "catalog-manifest.json"
    if existing_manifest.exists():
        previous = json.loads(existing_manifest.read_text(encoding="utf-8"))
        artifact = output_dir / f"catalog-cache-{revision}.sqlite.gz"
        if previous.get("generated_at") and previous.get("revision") == revision and artifact.exists() and hashlib.sha256(artifact.read_bytes()).hexdigest() == previous.get("sha256"):
            print(json.dumps(previous, indent=2, ensure_ascii=False))
            return artifact, existing_manifest
    sqlite_name = f"catalog-cache-{revision}.sqlite"
    gzip_name = f"{sqlite_name}.gz"
    sqlite_path = output_dir / sqlite_name
    gzip_path = output_dir / gzip_name
    manifest_path = output_dir / "catalog-manifest.json"

    if sqlite_path.exists():
        sqlite_path.unlink()
    db = sqlite3.connect(sqlite_path)
    try:
        db.executescript("""
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE catalog_game (
                id INTEGER PRIMARY KEY,
                app_id INTEGER,
                payload TEXT NOT NULL
            );
            CREATE INDEX ix_catalog_game_app_id ON catalog_game(app_id);
            CREATE TABLE game (
                id INTEGER PRIMARY KEY,
                app_id INTEGER,
                slug TEXT,
                name TEXT NOT NULL,
                credit_cost_per_hour INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1
            );
            CREATE INDEX ix_game_app_id ON game(app_id);
            CREATE INDEX ix_game_name ON game(name COLLATE NOCASE);
            CREATE TABLE game_metadata (
                game_id INTEGER PRIMARY KEY REFERENCES game(id) ON DELETE CASCADE,
                release_date TEXT,
                recommendation_count INTEGER,
                steam_review_score REAL,
                steam_review_count INTEGER,
                metacritic_score INTEGER,
                single_player INTEGER DEFAULT 0,
                multiplayer INTEGER DEFAULT 0,
                coop INTEGER DEFAULT 0,
                online_coop INTEGER DEFAULT 0,
                local_coop INTEGER DEFAULT 0,
                shared_split_screen INTEGER DEFAULT 0,
                mmo INTEGER DEFAULT 0,
                pvp INTEGER DEFAULT 0,
                pve INTEGER DEFAULT 0,
                lan INTEGER DEFAULT 0,
                cross_platform INTEGER DEFAULT 0,
                header_image TEXT,
                capsule_image TEXT,
                hero_image TEXT,
                steam_url TEXT,
                short_description TEXT
            );
            CREATE INDEX ix_gm_score ON game_metadata(steam_review_score);
            CREATE INDEX ix_gm_recommendation ON game_metadata(recommendation_count);
            CREATE INDEX ix_gm_release_date ON game_metadata(release_date);
            CREATE TABLE game_genre (
                game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                PRIMARY KEY (game_id, name)
            );
            CREATE INDEX ix_game_genre_name ON game_genre(name COLLATE NOCASE);
            CREATE TABLE game_tag (
                game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                PRIMARY KEY (game_id, name)
            );
            CREATE INDEX ix_game_tag_name ON game_tag(name COLLATE NOCASE);
            CREATE TABLE game_category (
                game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                PRIMARY KEY (game_id, name)
            );
            CREATE TABLE game_description (
                game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
                language TEXT NOT NULL,
                short_description TEXT,
                detailed_description TEXT,
                about_the_game TEXT,
                PRIMARY KEY (game_id, language)
            );
            CREATE INDEX ix_game_desc_lang ON game_description(game_id, language);
            CREATE TABLE game_detail (
                game_id INTEGER NOT NULL,
                language TEXT NOT NULL,
                country TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY(game_id, language, country)
            );
            CREATE INDEX ix_game_detail_lookup ON game_detail(game_id, language, country);
        """)
        db.executemany(
            "INSERT INTO metadata(key,value) VALUES (?,?)",
            [
                ("schema_version", "1"),
                ("revision", revision),
                ("generated_at", generated_at),
                ("catalog_count", str(len(catalog_rows))),
            ],
        )
        db.executemany(
            "INSERT INTO catalog_game(id, app_id, payload) VALUES (?,?,?)",
            catalog_rows,
        )

        game_rows = []
        metadata_rows = []
        genre_rows = []
        tag_rows = []
        category_rows = []
        for gid, app_id, payload_str in catalog_rows:
            try:
                g = json.loads(payload_str)
            except Exception:
                g = {}
            name = str(g.get("name") or "")
            slug = str(g.get("slug") or "")
            cost = int(g.get("credit_cost_per_hour") or 0)
            game_rows.append((gid, app_id, slug, name, cost, 1))

            metadata_rows.append((
                gid,
                g.get("release_date"),
                g.get("recommendation_count"),
                g.get("steam_review_score"),
                g.get("steam_review_count"),
                g.get("metacritic_score"),
                1 if g.get("single_player") else 0,
                1 if g.get("multiplayer") else 0,
                1 if g.get("coop") else 0,
                1 if g.get("online_coop") else 0,
                1 if g.get("local_coop") else 0,
                1 if g.get("shared_split_screen") else 0,
                1 if g.get("mmo") else 0,
                1 if g.get("pvp") else 0,
                1 if g.get("pve") else 0,
                1 if g.get("lan") else 0,
                1 if g.get("cross_platform") else 0,
                g.get("header_image"),
                g.get("capsule_image"),
                g.get("hero_image"),
                g.get("steam_url"),
                g.get("short_description"),
            ))
            for item in g.get("genres") or []:
                if isinstance(item, str) and item.strip():
                    genre_rows.append((gid, item.strip()))
            for item in g.get("tags") or []:
                if isinstance(item, str) and item.strip():
                    tag_rows.append((gid, item.strip()))
            for item in g.get("categories") or []:
                if isinstance(item, str) and item.strip():
                    category_rows.append((gid, item.strip()))

        db.executemany(
            "INSERT OR IGNORE INTO game(id, app_id, slug, name, credit_cost_per_hour, active) VALUES (?,?,?,?,?,?)",
            game_rows,
        )
        db.executemany(
            "INSERT OR REPLACE INTO game_metadata(game_id, release_date, recommendation_count, steam_review_score, steam_review_count, metacritic_score, single_player, multiplayer, coop, online_coop, local_coop, shared_split_screen, mmo, pvp, pve, lan, cross_platform, header_image, capsule_image, hero_image, steam_url, short_description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            metadata_rows,
        )
        db.executemany("INSERT OR IGNORE INTO game_genre(game_id, name) VALUES (?,?)", genre_rows)
        db.executemany("INSERT OR IGNORE INTO game_tag(game_id, name) VALUES (?,?)", tag_rows)
        db.executemany("INSERT OR IGNORE INTO game_category(game_id, name) VALUES (?,?)", category_rows)

        db.executemany(
            "INSERT INTO game_detail(game_id, language, country, payload) VALUES (?,?,?,?)",
            [(game_id, language, country, payload) for (game_id, language, country), payload in detail_rows.items()],
        )

        desc_rows = {}
        for gid, app_id, payload_str in catalog_rows:
            try:
                g = json.loads(payload_str)
            except Exception:
                g = {}
            short_desc = g.get("short_description") or ""
            desc_rows[(gid, "spanish")] = (gid, "spanish", short_desc, "", "")

        for (game_id, language, _country), payload in detail_rows.items():
            try:
                p = json.loads(payload)
                steam = p.get("steam") if isinstance(p.get("steam"), dict) else p
                short_d = steam.get("short_description") or p.get("short_description") or ""
                detailed_d = steam.get("detailed_description") or p.get("detailed_description") or ""
                about_d = steam.get("about_the_game") or p.get("about_the_game") or ""
                desc_rows[(game_id, language.lower())] = (game_id, language.lower(), short_d, detailed_d, about_d)
            except Exception:
                pass

        db.executemany(
            "INSERT OR REPLACE INTO game_description(game_id, language, short_description, detailed_description, about_the_game) VALUES (?,?,?,?,?)",
            list(desc_rows.values()),
        )
        db.commit()
        # The normalized tables duplicate what the payload already carries, and
        # every consumer rebuilds them: the client's cache fills game_tag,
        # game_genre, game_category and game_description from the payload, and
        # the server's own reads only ever touch catalog_game and game_detail.
        # They cost about 14 MB compressed, which the installer would ship twice.
        if strip_normalized:
            for table in ("game", "game_metadata", "game_genre", "game_tag",
                          "game_category", "game_description"):
                try:
                    db.execute(f"DROP TABLE IF EXISTS {table}")
                except sqlite3.Error as error:  # pragma: no cover - defensive
                    LOG.warning("Could not drop %s from the package: %s", table, error)
            db.commit()
        db.execute("VACUUM")
    finally:
        db.close()

    with sqlite_path.open("rb") as source, gzip.GzipFile(filename="", mode="wb", fileobj=gzip_path.open("wb"), mtime=0, compresslevel=9) as target:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            target.write(chunk)

    compressed = gzip_path.read_bytes()
    compressed_sha = hashlib.sha256(compressed).hexdigest()
    manifest = {
        "schema_version": 1,
        "revision": revision,
        "generated_at": generated_at,
        "artifact_url": (
            "https://raw.githubusercontent.com/sebasu66/gameAccess/"
            f"refs/heads/{github_ref}/deploy/catalog-cache/{gzip_name}"
        ),
        "sha256": compressed_sha,
        "catalog_count": len(catalog_rows),
        "detail_count": len(detail_rows),
        "compressed_bytes": len(compressed),
        "uncompressed_bytes": sqlite_path.stat().st_size,
        **({"coverage": coverage} if coverage else {}),
    }
    next_manifest = manifest_path.with_suffix(".next")
    next_manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    next_manifest.replace(manifest_path)

    sqlite_path.unlink()
    print(json.dumps(manifest, indent=2, ensure_ascii=False))
    return gzip_path, manifest_path

