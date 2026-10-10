from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, select

from app.digital_catalog import (
    DigitalGame,
    load_digital_catalog_json,
    sync_digital_catalog,
)
from app.main import Game, app


class MockSteamAdapter:
    def __init__(self):
        self.fetched = []

    def fetch(self, app_id: int, language: str = "spanish", country: str = "ar", force: bool = False) -> dict[str, Any]:
        self.fetched.append(app_id)
        return {
            "app_id": app_id,
            "name": f"Steam Title for {app_id}",
            "type": "game",
            "short_description": "Short description test",
            "about_the_game": "About the game test",
            "detailed_description": "Detailed description test",
            "genres": ["Action", "RPG"],
            "categories": ["Single-player", "Co-op"],
            "developers": ["Developer Test"],
            "publishers": ["Publisher Test"],
            "release_date": "2026-01-01",
            "header_image": f"https://cdn.example.com/{app_id}/header.jpg",
            "capsule_image": f"https://cdn.example.com/{app_id}/capsule.jpg",
        }

    def fetch_review_summary(self, app_id: int) -> dict[str, Any]:
        return {
            "steam_review_score": 95.0,
            "steam_review_count": 1000,
            "steam_positive_count": 950,
            "steam_negative_count": 50,
        }


import pytest

@pytest.fixture
def mock_catalog_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    p = tmp_path / "digital_catalog_test.json"
    data = [
        {"id": 2592160, "name": "Custom Dispatch", "downloadSource": "auto"},
        {"id": 47810, "name": "Dragon Age: Origins", "downloadSource": "auto"},
        {"id": 2054970, "name": "Dragon's Dogma 2", "downloadSource": "auto"},
        {"id": 2622380, "name": "Elden Ring Nightreign", "downloadSource": "auto"},
    ]
    # Add dummy entries to satisfy length checks
    for i in range(10):
        data.append({"id": 99000 + i, "name": f"Dummy {i}", "downloadSource": "auto"})
    
    p.write_text(json.dumps(data), encoding="utf-8")
    
    # Patch the function where it is defined
    monkeypatch.setattr("app.digital_catalog.get_digital_catalog_path", lambda p_arg=None: p)
    # Also patch where it might be imported in main or routes if necessary, but app.digital_catalog is the source
    monkeypatch.setattr("app.digital_admin_routes.get_digital_catalog_path", lambda p_arg=None: p)
    return p


def test_load_digital_catalog_json(mock_catalog_file: Path) -> None:
    records = load_digital_catalog_json()
    assert len(records) >= 11
    ids = [r["id"] for r in records]
    # Check key games are present
    assert 2592160 in ids  # Dispatch
    assert 47810 in ids    # Dragon Age: Origins
    assert 2054970 in ids  # Dragon's Dogma 2
    assert 2622380 in ids  # Elden Ring Nightreign


def test_source_catalog_is_not_exposed_by_current_product(mock_catalog_file: Path) -> None:
    # Sources belong to plugins. Helpers remain available for data migration.
    paths = {route.path for route in app.routes}
    assert "/digital/catalog" not in paths
    assert "/digital-catalog.json" not in paths
    assert "/library/catalog" in paths


def test_sync_digital_catalog_upserts_games_and_metadata(tmp_path: Path) -> None:
    test_json = tmp_path / "digital_test.json"
    test_json.write_text(
        json.dumps([
            {
                "name": "Custom Dispatch",
                "id": 2592160,
                "downloadSource": "https://example.com/dl",
                "installProcess": "setup.exe",
                "playProcess": "game.exe",
                "uninstallProcess": "uninst.exe"
            }
        ]),
        encoding="utf-8",
    )

    test_engine = create_engine("sqlite://")
    mock_adapter = MockSteamAdapter()

    res = sync_digital_catalog(
        engine=test_engine,
        catalog_path=test_json,
        fetch_steam=True,
        fetch_reviews=True,
        rate_limit_delay=0.0,
        steam_adapter=mock_adapter,
    )

    assert res["ok"] is True
    assert res["total"] == 1
    assert res["processed"] == 1
    assert res["steam_enriched"] == 1
    assert not res["errors"]

    with Session(test_engine) as session:
        # Check Game table
        game = session.exec(select(Game).where(Game.app_id == 2592160)).first()
        assert game is not None
        assert game.name == "Steam Title for 2592160"
        assert game.active is True

        # Check DigitalGame table
        dig = session.exec(select(DigitalGame).where(DigitalGame.steam_app_id == 2592160)).first()
        assert dig is not None
        assert dig.download_source == "https://example.com/dl"
        assert dig.install_process == "setup.exe"
        assert dig.play_process == "game.exe"
        assert dig.uninstall_process == "uninst.exe"

    # Check game_metadata table
    with test_engine.connect() as conn:
        meta = conn.exec_driver_sql(
            "SELECT steam_name, short_description, steam_review_score FROM game_metadata WHERE app_id = 2592160"
        ).first()
        assert meta is not None
        assert meta[0] == "Steam Title for 2592160"
        assert meta[1] == "Short description test"
        assert meta[2] == 95.0
