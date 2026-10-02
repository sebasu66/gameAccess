import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Session, SQLModel, create_engine

from app import main as core


INSTALL_A = "11111111-1111-4111-8111-111111111111"
INSTALL_B = "22222222-2222-4222-8222-222222222222"


def _request(installation_id: str) -> Request:
    return Request({
        "type": "http",
        "headers": [(b"x-gameaccess-installation", installation_id.encode("ascii"))],
    })


def _engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'leases.db'}")
    SQLModel.metadata.create_all(engine)
    core.ensure_catalog_schema(engine)
    return engine


def _game(session: Session, slug: str, app_id: int):
    game = core.Game(slug=slug, name=slug.title(), app_id=app_id, credit_cost_per_hour=0)
    session.add(game)
    session.commit()
    session.refresh(game)
    session.connection().exec_driver_sql(
        "INSERT INTO game_metadata (game_id, product_type, updated_at) VALUES (?, 'game', ?)",
        (game.id, core.now_utc().isoformat()),
    )
    return game


def _account(session: Session, label: str, app_ids: list[int], status=core.AccountStatus.free):
    account = core.ProviderAccount(
        label=label,
        status=status,
        notes=json.dumps({"accessible_app_ids": app_ids, "steam_id64": "76561198000000001"}),
    )
    session.add(account)
    session.commit()
    session.refresh(account)
    return account


def _activation(monkeypatch):
    expires_at = core.now_utc() + timedelta(hours=12)
    monkeypatch.setattr(
        core,
        "_activation_for_request",
        lambda request, session: SimpleNamespace(expires_at=expires_at),
    )
    return expires_at


def _old_lease(session: Session, user, game, account, installation_id=INSTALL_A):
    lease = core.Lease(
        user_id=user.id,
        game_id=game.id,
        account_id=account.id,
        starts_at=core.now_utc(),
        expires_at=core.now_utc() + timedelta(hours=12),
        credits_spent=0,
    )
    session.add(lease)
    session.commit()
    session.refresh(lease)
    session.add(core.LeaseCredentialGrant(
        lease_id=lease.id,
        installation_id=installation_id,
        created_at=core.now_utc(),
    ))
    session.commit()
    return lease


def test_same_installation_reuses_same_account_for_another_game(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    _activation(monkeypatch)
    with Session(engine) as session:
        user = core.User(username="demo", credits=1000)
        session.add(user)
        session.commit()
        session.refresh(user)
        first = _game(session, "first", 101)
        second = _game(session, "second", 102)
        account = _account(session, "shared-account", [101, 102], core.AccountStatus.leased)
        session.add_all([
            core.AccountGame(account_id=account.id, game_id=first.id),
            core.AccountGame(account_id=account.id, game_id=second.id),
        ])
        session.commit()
        old = _old_lease(session, user, first, account)

        result = core.create_lease(
            core.LeaseRequest(game_id=second.id, minutes=60),
            _request(INSTALL_A),
            session,
        )

        session.refresh(old)
        session.refresh(account)
        assert result["lease_id"] == old.id
        assert result["reused"] is True
        assert result["account"]["id"] == account.id
        assert old.status == core.LeaseStatus.active
        assert account.status == core.AccountStatus.leased


def test_other_installation_cannot_reuse_busy_account(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    _activation(monkeypatch)
    with Session(engine) as session:
        user = core.User(username="demo", credits=1000)
        session.add(user)
        session.commit()
        session.refresh(user)
        first = _game(session, "first", 101)
        second = _game(session, "second", 102)
        account = _account(session, "shared-account", [101, 102], core.AccountStatus.leased)
        session.add_all([
            core.AccountGame(account_id=account.id, game_id=first.id),
            core.AccountGame(account_id=account.id, game_id=second.id),
        ])
        session.commit()
        _old_lease(session, user, first, account, INSTALL_A)

        with pytest.raises(HTTPException) as exc:
            core.create_lease(
                core.LeaseRequest(game_id=second.id, minutes=60),
                _request(INSTALL_B),
                session,
            )
        assert exc.value.status_code == 409
        assert "ocupadas" in str(exc.value.detail)


def test_same_installation_replaces_only_after_valid_new_account_exists(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    expires_at = _activation(monkeypatch)
    with Session(engine) as session:
        user = core.User(username="demo", credits=1000)
        session.add(user)
        session.commit()
        session.refresh(user)
        first = _game(session, "first", 101)
        second = _game(session, "second", 102)
        old_account = _account(session, "old-account", [101], core.AccountStatus.leased)
        new_account = _account(session, "new-account", [102], core.AccountStatus.free)
        session.add_all([
            core.AccountGame(account_id=old_account.id, game_id=first.id),
            core.AccountGame(account_id=new_account.id, game_id=second.id),
        ])
        session.commit()
        old = _old_lease(session, user, first, old_account)

        result = core.create_lease(
            core.LeaseRequest(game_id=second.id, minutes=60),
            _request(INSTALL_A),
            session,
        )

        session.refresh(old)
        session.refresh(old_account)
        session.refresh(new_account)
        assert result["lease_id"] != old.id
        assert result["account"]["id"] == new_account.id
        assert result["reused"] is False
        assert old.status == core.LeaseStatus.released
        assert old_account.status == core.AccountStatus.free
        assert new_account.status == core.AccountStatus.leased
        assert core.utc(session.get(core.Lease, result["lease_id"]).expires_at) == core.utc(expires_at)
