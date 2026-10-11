from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool
from fastapi import Request
from app import main as core
from app.catalog_metadata import ensure_catalog_schema

def test_library_game_missing_from_baseline_is_saved_and_fetched_only_once(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    ensure_catalog_schema(engine)
    monkeypatch.setattr(core, "engine", engine)
    calls = []
    def fetch(app_id, **kwargs):
        calls.append(app_id)
        return {"app_id": app_id, "type": "game", "name": "Unepic",
                "short_description": "Fixture description", "genres": ["RPG"],
                "screenshots": [{"id": 1}], "movies": [{"id": 2}]}
    monkeypatch.setattr(core.steam_catalog, "fetch", fetch)
    with Session(engine) as session:
        request = Request({"type": "http", "headers": []})
        first = core.digital_game_details(request, 233980, "spanish", "ar", session)
        second = core.digital_game_details(request, 233980, "spanish", "ar", session)
    assert calls == [233980]
    assert first["steam"] == second["steam"]
    assert second["steam"]["screenshots"]
    assert second["steam"]["movies"]
    engine.dispose()
