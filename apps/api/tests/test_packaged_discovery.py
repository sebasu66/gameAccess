"""Verify the real installer seed is served as one complete metadata package."""
import gzip
import hashlib
import json
import sqlite3
from pathlib import Path
from fastapi.testclient import TestClient
from app import main, discovery_service

def test_packaged_catalog_is_served_with_matching_hash_and_steam_identities(tmp_path, monkeypatch):
    bundled = Path(__file__).resolve().parents[3] / "deploy/catalog-cache"
    monkeypatch.setattr(discovery_service, "ROOT", tmp_path)
    monkeypatch.setattr(discovery_service, "OUTPUT_DIR", bundled)
    client = TestClient(main.app)
    manifest = client.get("/library/catalog/manifest").json()
    assert manifest["catalog_count"] >= 25000
    assert manifest["coverage"]["recent_complete"]
    # Clients download the package from GitHub, never from this server.
    assert manifest["artifact_url"].startswith("https://raw.githubusercontent.com/")
    package = (bundled / manifest["artifact_url"].rsplit("/", 1)[1]).read_bytes()
    assert hashlib.sha256(package).hexdigest() == manifest["sha256"]
    database = sqlite3.connect(":memory:")
    database.deserialize(gzip.decompress(package))
    rows = database.execute("SELECT app_id, payload FROM catalog_game").fetchall()
    assert len(rows) == manifest["catalog_count"]
    assert len({app_id for app_id, _ in rows}) == len(rows)
    assert all("downloadSource" not in json.loads(payload) for _, payload in rows)
    assert dict(database.execute("SELECT key,value FROM metadata"))["generated_at"]
    database.close()
