from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import main as core
from app import provider_app_routes as provider_apps


def test_register_app_id_does_not_require_store_metadata() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        game, created = provider_apps.register_app_id(session, 1681430)
        assert created is True
        assert game.app_id == 1681430
        assert game.name == "Steam 1681430"
        assert game.active is False

        same_game, created_again = provider_apps.register_app_id(session, 1681430)
        assert created_again is False
        assert same_game.id == game.id


def test_metadata_failure_never_removes_registered_ownership(monkeypatch) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(core, "engine", engine)
    monkeypatch.setattr(provider_apps.time, "sleep", lambda _seconds: None)

    with Session(engine) as session:
        game, _ = provider_apps.register_app_id(session, 3008130)
        game_id = game.id

    def fail_metadata(_app_id: int):
        raise core.SteamCatalogError("429 Too Many Requests")

    monkeypatch.setattr(provider_apps, "_fetch_metadata_throttled", fail_metadata)
    provider_apps.enrich_app_id(3008130)

    with Session(engine) as session:
        game = session.exec(select(core.Game).where(core.Game.app_id == 3008130)).first()
        assert game is not None
        assert game.id == game_id
        assert game.name == "Steam 3008130"
        assert game.active is False


def test_provider_registration_route_is_mounted() -> None:
    paths = {getattr(route, "path", "") for route in core.app.routes}
    assert "/admin/pool/games/register-steam/{app_id}" in paths
