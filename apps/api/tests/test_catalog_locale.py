from sqlmodel import create_engine

from app.catalog_metadata import (
    ensure_catalog_schema,
    get_cached_steam_metadata_locale,
    upsert_steam_metadata_locale,
)


def test_localized_steam_metadata_round_trip() -> None:
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE game (id INTEGER PRIMARY KEY, app_id INTEGER, name TEXT, active INTEGER)"
        )
        conn.exec_driver_sql(
            "INSERT INTO game(id, app_id, name, active) VALUES (1, 42, 'Test', 1)"
        )

    ensure_catalog_schema(engine)
    payload = {"app_id": 42, "name": "English title"}
    upsert_steam_metadata_locale(engine, 1, "English", "AR", payload)

    assert get_cached_steam_metadata_locale(
        engine, 1, "english", "ar"
    ) == payload
