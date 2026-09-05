from datetime import timedelta

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

from app import main as core


def _seed(session: Session):
    user = core.User(username="lease-replace-user", credits=1000)
    first_game = core.Game(slug="first", name="First", credit_cost_per_hour=0)
    second_game = core.Game(slug="second", name="Second", credit_cost_per_hour=0)
    first_account = core.ProviderAccount(label="first-account", status=core.AccountStatus.leased)
    second_account = core.ProviderAccount(label="second-account", status=core.AccountStatus.free)
    session.add_all([user, first_game, second_game, first_account, second_account])
    session.commit()
    for item in [user, first_game, second_game, first_account, second_account]:
        session.refresh(item)
    session.add(core.AccountGame(account_id=first_account.id, game_id=first_game.id))
    session.add(core.AccountGame(account_id=second_account.id, game_id=second_game.id))
    old = core.Lease(
        user_id=user.id,
        game_id=first_game.id,
        account_id=first_account.id,
        starts_at=core.now_utc(),
        expires_at=core.now_utc() + timedelta(hours=1),
        credits_spent=0,
    )
    session.add(old)
    session.commit()
    session.refresh(old)
    return user, second_game, first_account, second_account, old


def test_active_lease_still_conflicts_without_explicit_replace(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'lease-conflict.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user, second_game, _, _, _ = _seed(session)
        try:
            core.create_lease(core.LeaseRequest(user_id=user.id, game_id=second_game.id, minutes=60), session)
        except HTTPException as exc:
            assert exc.status_code == 409
        else:
            raise AssertionError("expected active lease conflict")


def test_explicit_replace_releases_stale_lease_and_reuses_pool(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'lease-replace.db'}")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user, second_game, first_account, second_account, old = _seed(session)
        result = core.create_lease(
            core.LeaseRequest(user_id=user.id, game_id=second_game.id, minutes=60, replace_existing=True),
            session,
        )
        session.refresh(old)
        session.refresh(first_account)
        session.refresh(second_account)
        assert old.status == core.LeaseStatus.released
        assert first_account.status == core.AccountStatus.free
        assert result["lease_id"] != old.id
        created = session.get(core.Lease, result["lease_id"])
        assert created is not None and created.status == core.LeaseStatus.active
        assert second_account.status == core.AccountStatus.leased
