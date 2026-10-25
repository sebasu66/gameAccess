import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import httpx
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine
from app import main
from app.catalog_metadata import ensure_catalog_schema
import pytest
from fastapi import HTTPException
from app import discovery_service as service
from app.cooptimus import detail_metadata
from app.catalog_snapshot import write_snapshot


def test_central_package_matches_manifest_and_needs_no_license_tables(tmp_path, monkeypatch):
    write_snapshot([(7,10,json.dumps({"id":7,"app_id":10,"name":"Fixture","tags":["Puzzle"]}))], {}, tmp_path, "fixture")
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "_cached_revision", "")
    assert service.catalog_games()[0]["id"] == 10
    info = service.manifest()
    assert hashlib.sha256(service.package_path(info["revision"]).read_bytes()).hexdigest() == info["sha256"]
    with pytest.raises(HTTPException):
        service.package_path("../../private")


def test_failed_maintenance_preserves_last_package(tmp_path, monkeypatch):
    write_snapshot([(7,10,json.dumps({"id":7,"app_id":10,"name":"Fixture"}))], {}, tmp_path, "fixture")
    monkeypatch.setattr(service, "ROOT", tmp_path)
    previous = service.manifest()["revision"]
    monkeypatch.setattr(service, "sync_published", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    service.maintain_once()
    assert service.manifest()["revision"] == previous
    assert service._status["state"] == "failed"
    assert service._last_sync() > 0  # a failed attempt also counts, so a restart does not retry at once


def _published(tmp_path, rows):
    """A package as the GitHub job publishes it, served by a fake raw.githubusercontent.com."""
    source = tmp_path / "published"
    source.mkdir(exist_ok=True)
    write_snapshot(rows, {}, source, "fixture")
    info = json.loads((source / "catalog-manifest.json").read_text())
    package = (source / f"catalog-cache-{info['revision']}.sqlite.gz").read_bytes()
    info["artifact_url"] = f"https://raw.githubusercontent.com/x/y/dev/catalog-cache-{info['revision']}.sqlite.gz"
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path.endswith(".json"):
            return httpx.Response(200, json=info)
        return httpx.Response(200, content=package)

    return info, httpx.MockTransport(handler), calls


def test_the_server_only_downloads_a_new_published_revision(tmp_path, monkeypatch):
    root = tmp_path / "server"
    monkeypatch.setattr(service, "ROOT", root)
    monkeypatch.setenv("GAMEACCESS_DISCOVERY_SEED_MANIFEST", "https://raw.githubusercontent.com/x/y/dev/catalog-manifest.json")
    info, transport, calls = _published(tmp_path, [(7, 10, json.dumps({"id": 7, "app_id": 10, "name": "A"}))])
    assert service.sync_published(transport) is True
    assert service.manifest()["revision"] == info["revision"]
    assert service.package_path(info["revision"]).parent == root
    assert service.sync_published(transport) is False  # same revision: only the small manifest is asked for
    assert len(calls) == 3
    info2, transport2, _ = _published(tmp_path, [(7, 10, json.dumps({"id": 7, "app_id": 10, "name": "A"})),
                                                 (8, 20, json.dumps({"id": 8, "app_id": 20, "name": "B"}))])
    assert service.sync_published(transport2) is True
    batch = json.loads(gzip.decompress(service.update_batch(info["revision"], info2["revision"])))
    assert [g["app_id"] for g in batch["games"]] == [20]  # clients get only what is new


def test_a_package_with_the_wrong_hash_is_rejected(tmp_path, monkeypatch):
    root = tmp_path / "server"
    monkeypatch.setattr(service, "ROOT", root)
    info, _, _ = _published(tmp_path, [(7, 10, json.dumps({"id": 7, "app_id": 10, "name": "A"}))])
    info["sha256"] = "0" * 64
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=info) if r.url.path.endswith(".json") else httpx.Response(200, content=b"bad"))
    with pytest.raises(ValueError):
        service.sync_published(transport)
    assert not list(root.glob("catalog-cache-*")) and not (root / "catalog-manifest.json").exists()


def test_cooptimus_detail_fetch_uses_exact_id_and_cache(tmp_path):
    calls = []
    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, text="<games><game><steam>10</steam><local>4</local><online>8</online></game></games>")
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        first = detail_metadata(10, client, tmp_path)
        second = detail_metadata(10, client, tmp_path)
    assert len(calls) == 1
    assert first == second
    assert first["local_players_max"] == 4
    assert first["state"] == "ready"


def test_cooptimus_block_does_not_invent_player_numbers(tmp_path):
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403))) as client:
        result = detail_metadata(10, client, tmp_path)
    assert result["state"] == "unavailable"
    assert "local_players_max" not in result

def test_update_batch_contains_only_additions_and_changes_never_deletions(tmp_path, monkeypatch):
    first = [(7, 10, json.dumps({"id": 7, "app_id": 10, "name": "Existing"})),
             (8, 20, json.dumps({"id": 8, "app_id": 20, "name": "Omitted later"}))]
    write_snapshot(first, {}, tmp_path, "fixture")
    monkeypatch.setattr(service, "ROOT", tmp_path)
    base = service.manifest()["revision"]
    write_snapshot([first[0], (9, 30, json.dumps({"id": 9, "app_id": 30, "name": "New"}))], {}, tmp_path, "fixture")
    revision = service.manifest()["revision"]
    batch = json.loads(gzip.decompress(service.update_batch(base, revision)))
    assert batch["base_revision"] == base
    assert batch["revision"] == revision
    assert [game["app_id"] for game in batch["games"]] == [30]
    assert "deleted" not in batch
    assert "delete" not in batch

def test_inventory_diff_repairs_equal_revision_with_missing_game(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    write_snapshot([(7, 10, json.dumps({"id": 7, "app_id": 10, "name": "Present"})),
                    (8, 20, json.dumps({"id": 8, "app_id": 20, "name": "Missing"}))], {}, tmp_path, "fixture")
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "_cached_revision", "")
    app = FastAPI()
    app.include_router(service.router)
    revision = service.manifest()["revision"]
    response = TestClient(app).post("/library/catalog/reconcile",
                                   json={"present": [10, 999], "base_revision": revision})
    assert response.status_code == 200
    assert hashlib.sha256(response.content).hexdigest() == response.headers["X-Catalog-SHA256"]
    batch = json.loads(gzip.decompress(response.content))
    assert [game["app_id"] for game in batch["games"]] == [20]
    assert batch["base_revision"] == batch["revision"] == revision


def test_catalog_is_read_from_disk_and_only_identities_are_kept(tmp_path, monkeypatch):
    rows = [(i, 100 + i, json.dumps({"id": i, "app_id": 100 + i, "name": f"G{i}", "tags": ["x"]})) for i in range(1, 6)]
    write_snapshot(rows, {}, tmp_path, "fixture")
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "_cached_revision", "")
    identities, inventory = service.catalog_identities()
    assert identities == [101, 102, 103, 104, 105]
    assert inventory == hashlib.sha256(json.dumps(identities, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    assert not hasattr(service, "_cached_games")                       # the payloads are never kept between requests
    streamed = service.iter_catalog_games()
    assert next(streamed)["id"] == 101 and [g["id"] for g in streamed] == [102, 103, 104, 105]
    info = service.manifest()
    with service.snapshot_db(info["revision"], info["sha256"]) as db:
        assert db.execute("SELECT count(*) FROM catalog_game").fetchone()[0] == 5
    with pytest.raises(HTTPException):
        with service.snapshot_db(info["revision"], "0" * 64):
            pass


def test_library_catalog_streams_valid_json(monkeypatch):
    import asyncio
    from app import discovery_service
    from app.catalog_routes import library_catalog
    monkeypatch.setattr(discovery_service, "iter_catalog_games", lambda: iter([{"id": 1, "app_id": 1, "name": "A"}, {"id": 2, "app_id": 2, "name": "B"}]))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    main.Game.__table__.create(engine)
    ensure_catalog_schema(engine)
    with Session(engine) as session:
        response = library_catalog(session=session)

        async def collect():
            return b"".join([chunk.encode() if isinstance(chunk, str) else chunk async for chunk in response.body_iterator])
        body = asyncio.run(collect())
    assert [game["name"] for game in json.loads(body)] == ["A", "B"]
