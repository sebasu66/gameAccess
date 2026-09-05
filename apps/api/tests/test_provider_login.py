from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Session, SQLModel, create_engine

from app import main as core
from app.account_roster import SteamCredential


def test_login_requires_active_local_reservation(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'login.db'}")
    SQLModel.metadata.create_all(engine)
    local = Request({"type": "http", "client": ("127.0.0.1", 1234), "headers": []})
    remote = Request({"type": "http", "client": ("192.0.2.1", 1234), "headers": []})
    with Session(engine) as session:
        account = core.ProviderAccount(label="test-provider", notes='{"user_id32":123}')
        session.add(account)
        session.commit()
        lease = core.Lease(user_id=1, game_id=1, account_id=account.id,
                           starts_at=core.now_utc(), expires_at=core.now_utc() + timedelta(minutes=5),
                           credits_spent=0)
        session.add(lease)
        session.commit()
        with patch("app.account_roster.credential_for_label", return_value=SteamCredential("test-provider", "test-login", "test-password")):
            assert core.lease_steam_login(lease.id, local, session)["expectedUserId32"] == 123
            with pytest.raises(HTTPException) as exc:
                core.lease_steam_login(lease.id, remote, session)
            assert exc.value.status_code == 403
            lease.expires_at = core.now_utc() - timedelta(seconds=1)
            session.add(lease)
            session.commit()
            with pytest.raises(HTTPException) as exc:
                core.lease_steam_login(lease.id, local, session)
            assert exc.value.status_code == 409
