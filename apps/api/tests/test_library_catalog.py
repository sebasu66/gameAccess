from sqlmodel import Session, create_engine

from app import main
from app.catalog_metadata import ensure_catalog_schema, seed_known_games, upsert_steam_metadata


def test_library_metadata_does_not_require_licenses_or_download_sources():
    engine = create_engine("sqlite://")
    main.Game.__table__.create(engine)
    ensure_catalog_schema(engine)
    with Session(engine) as session:
        session.add(main.Game(id=7, app_id=1174180, slug="fixture", name="Fixture"))
        session.add(main.Game(id=8, app_id=123, slug="inactive", name="Inactive", active=False))
        session.commit()
    seed_known_games(engine)
    upsert_steam_metadata(engine, 7, {"app_id": 1174180, "type": "game", "genres": ["Action"], "categories": ["Single-player"]})
    # No account, entitlement, source-list or lease tables exist in this database.
    with Session(engine) as session:
        result = main.library_catalog(session=session)
    assert len(result) == 1
    assert result[0]["id"] == result[0]["app_id"] == 1174180
    assert result[0]["name"] == "Fixture"
    assert result[0]["genres"] == ["Action"]
    assert "downloadSource" not in result[0]
