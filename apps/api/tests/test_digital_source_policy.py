import json
from sqlalchemy import inspect, text
from sqlmodel import Session, create_engine, select
from app import digital_admin_routes as routes
from app.digital_catalog import DigitalSourceRecord, ensure_digital_source_schema
from app.digital_source_policy import annotate_source_policies

def test_source_policy_persists_and_partial_updates_preserve_it(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "sources.db"))
    monkeypatch.setattr(routes, "default_engine", engine)
    monkeypatch.setattr(routes, "get_sources_path", lambda: tmp_path / "sources.json")
    routes.add_or_update_source(routes.SourceItem(url="https://example.com/source.json"))
    assert routes.load_sources_config()["sources"][0]["auto_installed"] is False
    routes.add_or_update_source(routes.SourceItem(url="https://example.com/source.json", auto_installed=True))
    routes.add_or_update_source(routes.SourceItem(url="https://example.com/source.json", priority=4))
    assert routes.load_sources_config()["sources"][0]["auto_installed"] is True
    with Session(engine) as session:
        assert session.exec(select(DigitalSourceRecord)).one().auto_installed is True
    routes.add_or_update_source(routes.SourceItem(url="https://example.com/source.json", auto_installed=False))
    assert json.loads((tmp_path / "sources.json").read_text())["sources"][0]["auto_installed"] is False

def test_migrates_existing_sources_with_false_default(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "legacy.db"))
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE digital_source (id INTEGER PRIMARY KEY, url TEXT)"))
        connection.execute(text("INSERT INTO digital_source (url) VALUES ('legacy')"))
    ensure_digital_source_schema(engine)
    ensure_digital_source_schema(engine)
    assert "auto_installed" in {c["name"] for c in inspect(engine).get_columns("digital_source")}
    with engine.connect() as connection:
        assert not connection.execute(text("SELECT auto_installed FROM digital_source")).scalar_one()

def test_policy_follows_selected_package_source_and_defaults_false(monkeypatch):
    sources = [
        {"url": "automatic", "label": "Auto", "priority": 1, "auto_installed": True},
        {"url": "manual", "label": "Manual", "priority": 2},
    ]
    monkeypatch.setattr(routes, "load_sources_config", lambda: {"sources": sources})
    monkeypatch.setattr(routes, "load_cached_downloads", lambda: [
        {"uri": "magnet:manual", "source_url": "manual"},
        {"uri": "https://download/auto", "source": "Auto"},
    ])
    rows = annotate_source_policies([
        {"id": 1, "downloadSource": "magnet:manual"},
        {"id": 2, "downloadSource": "https://download/auto"},
        {"id": 3, "downloadSource": "unknown"},
    ])
    assert [r["auto_installed"] for r in rows] == [False, True, False]
    assert rows[0]["source_url"] == "manual"
    assert rows[1]["source_url"] == "automatic"
