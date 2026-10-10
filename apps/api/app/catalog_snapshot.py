from __future__ import annotations
import gzip
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

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


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def write_snapshot(catalog_rows: list[tuple[int, int | None, str]], detail_rows: dict[tuple[int, str, str], str], output_dir: Path, github_ref: str, coverage: dict | None = None) -> tuple[Path, Path]:
    """Publish metadata only; consumers validate hash, schema and row count."""
    output_dir.mkdir(parents=True, exist_ok=True)
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
            CREATE TABLE game_detail (
                game_id INTEGER NOT NULL,
                language TEXT NOT NULL,
                country TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY(game_id, language, country)
            );
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
        db.executemany(
            "INSERT INTO game_detail(game_id, language, country, payload) VALUES (?,?,?,?)",
            [(game_id, language, country, payload) for (game_id, language, country), payload in detail_rows.items()],
        )
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

