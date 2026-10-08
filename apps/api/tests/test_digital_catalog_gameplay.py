from sqlmodel import Session, create_engine

from app import main
from app.catalog_metadata import ensure_catalog_schema, seed_known_games, upsert_steam_metadata


def test_digital_catalog_joins_cached_gameplay_by_app_id(monkeypatch):
    engine = create_engine("sqlite://")
    main.Game.__table__.create(engine)
    ensure_catalog_schema(engine)
    with Session(engine) as session:
        game = main.Game(id=7, app_id=1174180, slug="rdr2", name="RDR2")
        session.add(game)
        session.commit()
    seed_known_games(engine)
    upsert_steam_metadata(engine, 7, {
        "app_id": 1174180,
        "categories": ["Single-player", "Online Co-op", "Online PvP"],
        "genres": ["Action"],
        "release_date": "5 DIC 2019",
    })
    records = [
        {"id": 1174180, "name": "Digital title", "downloadSource": "https://example.com/game", "playProcess": "game.exe"},
        {"id": 999999, "name": "Unknown metadata", "downloadSource": "https://example.com/other"},
        {"id": 10, "name": "No source", "downloadSource": ""},
    ]
    monkeypatch.setattr(main, "load_digital_catalog_json", lambda: records)
    with Session(engine) as session:
        result = main.get_digital_catalog(all=False, session=session)
    assert len(result) == 2
    assert result[0]["online_coop"] is True
    assert result[0]["single_player"] is True
    assert result[0]["release_date"] == "5 DIC 2019"
    assert "Online PvP" in result[0]["categories"]
    assert result[0]["name"] == "Digital title"
    assert result[0]["playProcess"] == "game.exe"
    assert "online_coop" not in result[1]
    assert "categories" not in records[0]
