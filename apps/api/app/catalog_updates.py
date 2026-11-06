"""Catalog update batches between two published packages, built by the daily GitHub job and served from GitHub.

A batch holds only the games and details that are new or changed (never deletions). The job publishes one batch
from each of the last few revisions to the new one, next to the package, so clients download either the small
batch or the full package straight from GitHub: the server only says which one, and no catalog byte goes out
through it.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import shutil
import sqlite3
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path

from .catalog_snapshot import stable_json

LOG = logging.getLogger("gameaccess.catalog_updates")
UPDATE_BASES = 3          # batches from the last three revisions: clients up to three days behind get a batch
HISTORY_COMMITS = 40      # manifest commits looked at to find those revisions
RAW_BASE = "https://raw.githubusercontent.com/sebasu66/gameAccess/refs/heads/{ref}/deploy/catalog-cache/{name}"


def update_name(base_revision: str, revision: str) -> str:
    return f"catalog-update-{base_revision}-{revision}.json.gz"


@contextmanager
def _unpacked(package: Path):
    with tempfile.TemporaryDirectory(prefix="ga-catalog-") as directory:
        target = Path(directory) / "catalog.sqlite"
        with gzip.open(package, "rb") as packed, target.open("wb") as unpacked:
            shutil.copyfileobj(packed, unpacked, 1 << 20)
        yield target


def build_update(previous: Path, current: Path, base_revision: str, revision: str) -> bytes:
    """The gzip batch that takes a client from `previous` to `current` (both .sqlite.gz packages).

    Both packages are compared on disk with SQL, so only new and changed rows are ever loaded."""
    with _unpacked(previous) as old, _unpacked(current) as new:
        db = sqlite3.connect(new)
        try:
            db.execute("ATTACH DATABASE ? AS prev", (str(old),))
            db.execute("CREATE INDEX IF NOT EXISTS prev.ix_ga_identity ON catalog_game(coalesce(nullif(app_id, 0), id))")
            key = "coalesce(nullif({t}.app_id, 0), {t}.id)"
            games = [json.loads(payload) for (payload,) in db.execute(
                f"SELECT c.payload FROM main.catalog_game c LEFT JOIN prev.catalog_game p "
                f"ON {key.format(t='p')} = {key.format(t='c')} WHERE p.payload IS NOT c.payload ORDER BY c.rowid")]
            details = [{"game_id": gid, "language": lang, "country": country, "app_id": app_id, "payload": json.loads(payload)}
                       for gid, lang, country, app_id, payload in db.execute(
                           "SELECT d.game_id, d.language, d.country, g.app_id, d.payload FROM main.game_detail d "
                           "LEFT JOIN prev.game_detail p ON p.game_id = d.game_id AND p.language = d.language "
                           "AND p.country = d.country LEFT JOIN main.catalog_game g ON g.id = d.game_id "
                           "WHERE p.payload IS NOT d.payload ORDER BY d.rowid")]
        finally:
            db.close()
    batch = {"schema_version": 1, "base_revision": base_revision, "revision": revision, "games": games, "details": details}
    return gzip.compress(stable_json(batch).encode("utf-8"), mtime=0)


def _git(args: list[str], cwd: Path) -> bytes:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, timeout=300).stdout


def published_packages(output_dir: Path, workdir: Path, exclude: str, limit: int = UPDATE_BASES) -> list[tuple[str, Path]]:
    """The packages of the last `limit` revisions committed before, read from git history into `workdir`.

    Each is checked against the hash its own manifest declared. Without git history (a shallow or missing
    repository) the list is empty and clients simply get the full package."""
    found: list[tuple[str, Path]] = []
    try:
        root = Path(_git(["rev-parse", "--show-toplevel"], output_dir).decode().strip())
        rel = output_dir.resolve().relative_to(root.resolve()).as_posix()
        commits = _git(["log", f"-n{HISTORY_COMMITS}", "--format=%H", "--", f"{rel}/catalog-manifest.json"], root).decode().split()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        LOG.warning("No git history for catalog update batches: %s", error)
        return found
    seen = {exclude}
    for commit in commits:
        if len(found) >= limit:
            break
        try:
            info = json.loads(_git(["show", f"{commit}:{rel}/catalog-manifest.json"], root))
            revision = info["revision"]
            if revision in seen:
                continue
            seen.add(revision)
            data = _git(["show", f"{commit}:{rel}/catalog-cache-{revision}.sqlite.gz"], root)
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            LOG.warning("Skipping catalog commit %s: %s", commit[:8], error)
            continue
        if hashlib.sha256(data).hexdigest() != info.get("sha256"):
            LOG.warning("Skipping catalog revision %s: package does not match its manifest", revision)
            continue
        target = workdir / f"catalog-cache-{revision}.sqlite.gz"
        target.write_bytes(data)
        found.append((revision, target))
    return found


def publish_updates(output_dir: Path, bases: list[tuple[str, Path]], github_ref: str) -> dict:
    """Write one batch per base next to the current package and list them in the manifest under `updates`.

    Batches for older bases are removed, so the folder only ever holds the batches the manifest names."""
    manifest_path = output_dir / "catalog-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    revision = manifest["revision"]
    current = output_dir / f"catalog-cache-{revision}.sqlite.gz"
    updates = {}
    for base, package in bases:
        if base == revision:
            continue
        name = update_name(base, revision)
        data = build_update(package, current, base, revision)
        (output_dir / name).write_bytes(data)
        updates[base] = {"artifact_url": RAW_BASE.format(ref=github_ref, name=name),
                         "sha256": hashlib.sha256(data).hexdigest(), "compressed_bytes": len(data)}
    for old in output_dir.glob("catalog-update-*.json.gz"):
        if old.name not in {update_name(base, revision) for base in updates}:
            old.unlink()
    manifest["updates"] = updates
    staged = manifest_path.with_suffix(".tmp")
    staged.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    staged.replace(manifest_path)
    LOG.info("Catalog update batches published: revision=%s bases=%s", revision, list(updates))
    return updates
