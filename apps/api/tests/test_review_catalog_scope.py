"""Public discovery reviews do not depend on accounts or license ownership."""
from sqlmodel import Session, create_engine
from app import main
from app.catalog_metadata import ensure_catalog_schema, seed_known_games, upsert_steam_metadata, next_steam_review_target

def test_public_game_is_enriched_without_an_accountgame_table():
    engine = create_engine("sqlite://")
    main.Game.__table__.create(engine)
    ensure_catalog_schema(engine)
    with Session(engine) as session:
        session.add(main.Game(id=1, app_id=42, name="Public fixture", slug="public-fixture"))
        session.commit()
    seed_known_games(engine)
    upsert_steam_metadata(engine, 1, {"app_id":42, "type":"game", "name":"Public fixture"})
    assert next_steam_review_target(engine) == (1,42)
