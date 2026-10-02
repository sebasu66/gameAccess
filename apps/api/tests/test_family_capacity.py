import json

from sqlmodel import Session, SQLModel, create_engine

from app import family_capacity as capacity
from app import main as core


def _make_session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'provider-capacity.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    core.ensure_catalog_schema(engine)
    return engine


def _mark_game(session: Session, game: core.Game) -> None:
    session.connection().exec_driver_sql(
        "INSERT INTO game_metadata (game_id, product_type, updated_at) VALUES (?, 'game', ?)",
        (game.id, core.now_utc().isoformat()),
    )


def _game(session: Session, app_id: int = 730) -> core.Game:
    game = core.Game(
        slug=f"game-{app_id}",
        name=f"Game {app_id}",
        app_id=app_id,
        active=True,
        credit_cost_per_hour=10,
    )
    session.add(game)
    session.commit()
    session.refresh(game)
    _mark_game(session, game)
    return game


def _account(
    session: Session,
    label: str,
    app_id: int,
    *,
    status: core.AccountStatus = core.AccountStatus.free,
    credential_status: str | None = None,
    account_name: str | None = None,
) -> core.ProviderAccount:
    notes = {
        "account_name": account_name or label.split("#", 1)[0],
        "provider_id": account_name or label.split("#", 1)[0],
        "accessible_app_ids": [app_id],
    }
    if credential_status:
        notes["credential_status"] = credential_status
    account = core.ProviderAccount(
        label=label,
        provider="steam",
        status=status,
        notes=json.dumps(notes),
    )
    session.add(account)
    session.commit()
    session.refresh(account)
    return account


def test_family_graph_does_not_change_play_selection(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = _game(session, 10)
        first = _account(session, "first", 10)
        _account(session, "second", 10)

        capacity.replace_family_graph(
            session,
            [{
                "family_key": "diagnostic-family",
                "members": ["first"],
                "licenses": [{"app_id": 10, "quantity": 1, "owner_labels": ["first"]}],
            }],
        )

        selection = capacity.select_best_account(session, game)
        assert selection is not None
        assert selection["mode"] == "verified-access"
        assert selection["family_id"] is None
        assert selection["account"].id == first.id
        assert capacity.game_capacity(session, game) == (2, 2)


def test_historical_disabled_status_is_not_an_access_gate(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = _game(session, 20)
        account = _account(
            session,
            "legacy-disabled",
            20,
            status=core.AccountStatus.disabled,
            credential_status="unknown",
        )

        selection = capacity.select_best_account(session, game)
        assert selection is not None
        assert selection["account"].id == account.id
        assert capacity.game_capacity(session, game) == (1, 1)


def test_explicit_invalid_password_excludes_provider(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = _game(session, 30)
        _account(
            session,
            "bad-password",
            30,
            status=core.AccountStatus.disabled,
            credential_status="invalid_password",
        )
        good = _account(session, "good-password", 30, credential_status="valid")

        selection = capacity.select_best_account(session, game)
        assert selection is not None
        assert selection["account"].id == good.id
        assert capacity.game_capacity(session, game) == (1, 1)


def test_active_lease_not_status_field_makes_identity_busy(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = _game(session, 40)
        busy = _account(
            session,
            "busy",
            40,
            status=core.AccountStatus.free,
        )
        free = _account(
            session,
            "free",
            40,
            status=core.AccountStatus.leased,
        )
        lease = core.Lease(
            user_id=1,
            game_id=game.id,
            account_id=busy.id,
            starts_at=core.now_utc(),
            expires_at=core.now_utc(),
            credits_spent=0,
            status=core.LeaseStatus.active,
        )
        session.add(lease)
        session.commit()

        selection = capacity.select_best_account(session, game)
        assert selection is not None
        assert selection["account"].id == free.id
        assert capacity.game_capacity(session, game) == (2, 1)


def test_duplicate_rows_for_same_steam_login_count_once(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = _game(session, 50)
        canonical = _account(
            session,
            "alice",
            50,
            credential_status="valid",
            account_name="alice",
        )
        duplicate = _account(
            session,
            "alice#2",
            50,
            credential_status="unknown",
            account_name="alice",
        )

        assert capacity.game_capacity(session, game) == (1, 1)
        selection = capacity.select_best_account(session, game)
        assert selection is not None
        assert selection["account"].id == canonical.id

        lease = core.Lease(
            user_id=1,
            game_id=game.id,
            account_id=duplicate.id,
            starts_at=core.now_utc(),
            expires_at=core.now_utc(),
            credits_spent=0,
            status=core.LeaseStatus.active,
        )
        session.add(lease)
        session.commit()

        assert capacity.select_best_account(session, game) is None
        assert capacity.game_capacity(session, game) == (1, 0)


def test_known_owned_mapping_is_access_evidence_without_family(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = _game(session, 60)
        account = core.ProviderAccount(
            label="mapped-owner",
            provider="steam",
            status=core.AccountStatus.disabled,
            notes=json.dumps({"credential_status": "unknown"}),
        )
        session.add(account)
        session.commit()
        session.refresh(account)
        session.add(core.AccountGame(account_id=account.id, game_id=game.id))
        session.commit()

        assert capacity.account_can_access_game(session, account, game)
        assert capacity.game_capacity(session, game) == (1, 1)
        assert capacity.select_best_account(session, game)["account"].id == account.id


def test_demand_value_still_increases_and_is_bounded(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = _game(session, 99)
        assert capacity.demand_fields(session, int(game.id))["demand_value"] == 1.0

        for _ in range(100):
            capacity.record_successful_lease(session, int(game.id))
            session.commit()

        fields = capacity.demand_fields(session, int(game.id))
        assert fields["request_count_total"] == 100
        assert fields["successful_leases"] == 100
        assert fields["demand_value"] == capacity.DEMAND_MAX
