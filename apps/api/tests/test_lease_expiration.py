from datetime import timedelta

from sqlmodel import Session, SQLModel, create_engine

from app import main as core


def test_sqlite_active_lease_does_not_break_catalog(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'leases.db'}")
    SQLModel.metadata.create_all(engine)
    core.ensure_catalog_schema(engine)
    with Session(engine) as session:
        game = core.Game(slug="test", name="Test", app_id=12345)
        account = core.ProviderAccount(label="test", status=core.AccountStatus.leased)
        session.add(game)
        session.add(account)
        session.commit()
        session.refresh(game)
        session.refresh(account)
        session.connection().exec_driver_sql(
            "INSERT INTO game_metadata (game_id, product_type, updated_at) VALUES (?, 'game', ?)",
            (game.id, core.now_utc().isoformat()),
        )
        session.add(core.AccountGame(account_id=account.id, game_id=game.id))
        session.commit()
        lease = core.Lease(user_id=1, game_id=game.id, account_id=account.id,
                           starts_at=core.now_utc(), expires_at=core.now_utc() + timedelta(hours=1),
                           credits_spent=0)
        session.add(lease)
        session.commit()
        session.refresh(lease)
        assert lease.expires_at.tzinfo is None
        from fastapi import Response
        assert core.catalog(Response(), session=session)[0]["name"] == "Test"
        assert lease.status == core.LeaseStatus.active
        lease.expires_at = core.now_utc() - timedelta(seconds=1)
        session.add(lease)
        session.commit()
        session.refresh(lease)
        core.expire_old_leases(session)
        assert lease.status == core.LeaseStatus.expired
        session.refresh(account)
        assert account.status == core.AccountStatus.free
