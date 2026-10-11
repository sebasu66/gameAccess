import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import httpx
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
    monkeypatch.setattr(service, "refresh", lambda args: (_ for _ in ()).throw(RuntimeError("offline")))
    service.maintain_once()
    assert service.manifest()["revision"] == previous
    assert service._status["state"] == "failed"


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
