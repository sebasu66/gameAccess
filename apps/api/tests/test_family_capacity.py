from sqlmodel import Session, SQLModel, create_engine

from app import main as core
from app import family_capacity as capacity


def _make_session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'family-capacity.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _seed_example(session: Session):
    games = {}
    for slug, name, app_id in (("a", "Game A", 10), ("b", "Game B", 20), ("c", "Game C", 30)):
        game = core.Game(slug=slug, name=name, app_id=app_id, active=True, credit_cost_per_hour=10)
        session.add(game)
        games[slug] = game
    accounts = {}
    for label in ("X", "Y", "Z", "V"):
        account = core.ProviderAccount(label=label, provider="steam", status=core.AccountStatus.free)
        session.add(account)
        accounts[label] = account
    session.commit()
    for row in [*games.values(), *accounts.values()]:
        session.refresh(row)

    capacity.replace_family_graph(
        session,
        [
            {
                "family_key": "family-1",
                "members": ["X", "Y", "Z"],
                "licenses": [
                    {"app_id": 10, "quantity": 2, "owner_labels": ["X", "Y"]},
                    {"app_id": 20, "quantity": 1, "owner_labels": ["Z"]},
                ],
            },
            {
                "family_key": "family-2",
                "members": ["V"],
                "licenses": [
                    {"app_id": 10, "quantity": 1, "owner_labels": ["V"]},
                    {"app_id": 20, "quantity": 1, "owner_labels": ["V"]},
                    {"app_id": 30, "quantity": 1, "owner_labels": ["V"]},
                ],
            },
        ],
    )
    return games, accounts


def test_family_capacity_counts_independent_copies_not_visible_accounts(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        games, _accounts = _seed_example(session)
        assert capacity.game_capacity(session, games["a"]) == (3, 3)
        assert capacity.game_capacity(session, games["b"]) == (2, 2)
        assert capacity.game_capacity(session, games["c"]) == (1, 1)


def test_family_breakdowns_are_built_from_one_snapshot(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        games, _accounts = _seed_example(session)
        breakdowns = capacity.family_breakdowns_by_game(session)

        assert [row["family_key"] for row in breakdowns[int(games["a"].id)]] == [
            "family-1",
            "family-2",
        ]
        assert breakdowns[int(games["b"].id)][0]["available_seats"] == 1
        assert breakdowns[int(games["c"].id)][0]["owners"] == ["V"]


def test_simulation_prefers_family_that_preserves_more_pool_capacity(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        games, accounts = _seed_example(session)
        selection = capacity.select_best_account(session, games["b"])
        assert selection is not None
        assert selection["mode"] == "family-simulation"
        assert selection["account"].label in {"X", "Y", "Z"}
        assert selection["account"].label != "V"

        selection["account"].status = core.AccountStatus.leased
        session.add(selection["account"])
        lease = core.Lease(
            user_id=1,
            game_id=games["b"].id,
            account_id=selection["account"].id,
            starts_at=core.now_utc(),
            expires_at=core.now_utc(),
            credits_spent=0,
            status=core.LeaseStatus.active,
        )
        session.add(lease)
        session.commit()
        session.refresh(lease)
        capacity.register_lease_allocation(
            session,
            int(lease.id),
            selection["family_id"],
            selection["license_copy_id"],
        )
        session.commit()

        assert capacity.game_capacity(session, games["a"])[1] == 3
        assert capacity.game_capacity(session, games["b"])[1] == 1
        assert capacity.game_capacity(session, games["c"])[1] == 1
        assert accounts["V"].status == core.AccountStatus.free


def test_demand_value_increases_and_is_bounded(tmp_path) -> None:
    engine = _make_session(tmp_path)
    with Session(engine) as session:
        game = core.Game(slug="value", name="Value", app_id=99, active=True)
        session.add(game)
        session.commit()
        session.refresh(game)
        assert capacity.demand_fields(session, int(game.id))["demand_value"] == 1.0

        for _ in range(100):
            capacity.record_successful_lease(session, int(game.id))
            session.commit()

        fields = capacity.demand_fields(session, int(game.id))
        assert fields["request_count_total"] == 100
        assert fields["successful_leases"] == 100
        assert fields["demand_value"] == capacity.DEMAND_MAX
