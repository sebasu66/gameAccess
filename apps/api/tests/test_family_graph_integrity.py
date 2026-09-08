"""Regression contracts for graph integrity and shared capacity semantics."""

import json

import pytest
from app import family_capacity as capacity
from app import family_graph_write as writer
from app import main as core
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select


@pytest.fixture
def pool(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'pool.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        game = core.Game(slug="shared", name="Shared", app_id=10, active=True)
        session.add(game)
        for index in range(6):
            session.add(
                core.ProviderAccount(
                    label=f"member-{index}",
                    status=core.AccountStatus.free,
                    notes=json.dumps({"accessible_app_ids": [10]}),
                )
            )
        session.commit()
        yield session, game
    engine.dispose()


def graph(quantity=1):
    return [
        {
            "family_key": "verified-family",
            "members": [f"member-{index}" for index in range(6)],
            "licenses": [
                {
                    "app_id": 10,
                    "quantity": quantity,
                    "owner_labels": [f"member-{index}" for index in range(quantity)],
                }
            ],
        }
    ]


def identities(session):
    return sorted(
        (row.id, row.family_id, row.game_id, row.owner_account_id)
        for row in session.exec(select(capacity.FamilyGameLicenseCopy)).all()
    )


@pytest.mark.parametrize("quantity", [1, 2])
def test_copies_are_not_multiplied_by_borrowers(pool, quantity):
    session, game = pool
    capacity.replace_family_graph(session, graph(quantity))
    assert capacity.game_capacity(session, game) == (quantity, quantity)
    rows = capacity.family_breakdown_for_game(session, game.id)
    assert sum(row["available_seats"] for row in rows) == quantity
    assert rows[0]["eligible_free_members"] == 6


def test_breakdown_applies_same_access_check_as_allocator(pool):
    session, game = pool
    capacity.replace_family_graph(session, graph(2))
    for account in session.exec(select(core.ProviderAccount)).all():
        account.notes = json.dumps({"accessible_app_ids": []})
        session.add(account)
    session.commit()
    rows = capacity.family_breakdown_for_game(session, game.id)
    assert rows[0]["free_members"] == 6
    assert rows[0]["eligible_free_members"] == 0
    assert rows[0]["available_seats"] == 0
    assert capacity.game_capacity(session, game) == (2, 0)
    assert capacity.select_best_account(session, game) is None


def test_unchanged_refresh_preserves_copy_identity(pool):
    session, _ = pool
    capacity.replace_family_graph(session, graph(2))
    before = identities(session)
    capacity.replace_family_graph(session, graph(2))
    assert identities(session) == before


@pytest.mark.parametrize("bad_kind", ["duplicate-member", "quantity", "owner"])
def test_invalid_snapshot_preserves_previous_graph(pool, bad_kind):
    session, _ = pool
    capacity.replace_family_graph(session, graph())
    before = identities(session)
    invalid = graph()
    if bad_kind == "duplicate-member":
        invalid[0]["members"].append("member-0")
    elif bad_kind == "quantity":
        invalid[0]["licenses"][0]["quantity"] = 6
    else:
        invalid[0]["licenses"][0]["owner_labels"] = ["unknown"]
    with pytest.raises(HTTPException) as caught:
        capacity.replace_family_graph(session, invalid)
    assert caught.value.status_code == 422
    assert identities(session) == before


def test_failed_write_rolls_back_family_and_membership_changes(pool, monkeypatch):
    session, _ = pool
    capacity.replace_family_graph(session, graph())
    before = identities(session)
    initial_members = session.exec(select(capacity.FamilyMember)).all()
    membership_ids = sorted(row.id for row in initial_members)

    def fail(*args):
        raise RuntimeError("injected storage failure")

    changed = graph(2)
    changed[0]["family_key"] = "replacement-family"
    monkeypatch.setattr(writer, "_sync_copies", fail)
    with pytest.raises(RuntimeError, match="injected"):
        capacity.replace_family_graph(session, changed)
    assert identities(session) == before
    assert (
        sorted(row.id for row in session.exec(select(capacity.FamilyMember)).all())
        == membership_ids
    )
    assert len(session.exec(select(capacity.ProviderFamily)).all()) == 1


def test_busy_graph_rejected_without_invalidating_allocation(pool):
    session, game = pool
    capacity.replace_family_graph(session, graph())
    before = identities(session)
    account = session.exec(select(core.ProviderAccount)).first()
    account.status = core.AccountStatus.leased
    lease = core.Lease(
        user_id=1,
        game_id=game.id,
        account_id=account.id,
        starts_at=core.now_utc(),
        expires_at=core.now_utc(),
        status=core.LeaseStatus.active,
        credits_spent=0,
    )
    session.add(account)
    session.add(lease)
    session.commit()
    capacity.register_lease_allocation(session, lease.id, before[0][1], before[0][0])
    session.commit()
    with pytest.raises(HTTPException) as caught:
        capacity.replace_family_graph(session, graph(2))
    assert caught.value.status_code == 409
    assert identities(session) == before
    allocation = session.exec(select(capacity.LeaseAllocation)).one()
    assert allocation.license_copy_id == before[0][0]
