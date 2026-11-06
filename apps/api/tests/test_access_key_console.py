"""The admin console shows an issued key again, and where and when the installation using it last connected."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from app import main as core
from app.access_keys import AccessKey


@pytest.fixture
def activation_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


def _request(headers):
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                    "client": ("10.0.0.9", 5000)})


def test_key_is_shown_again_with_last_connection_and_can_be_revoked(activation_db, monkeypatch, tmp_path):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "t" * 32)
    monkeypatch.delenv("GAMEACCESS_KEY_SECRET", raising=False)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(tmp_path / "absent.json"))
    admin = _request({"X-GameAccess-Admin-Token": "t" * 32})
    installation = str(uuid4())
    with Session(activation_db) as session:
        issued = core.create_access_keys(core.AccessKeyIssueRequest(
            expires_at=datetime.now(timezone.utc) + timedelta(days=30), access_tier="plus", label="Juan"), admin, session)
        printable = issued["keys"][0]["key"]
        listed = core.list_access_keys(admin, session)["keys"][0]
        assert listed["key"] == printable and listed["last_seen_at"] is None   # shown again, never connected yet
        assert session.get(AccessKey, listed["id"]).key_enc != printable       # stored encrypted, not in clear

        redeemed = core.redeem_access_key(
            core.AccessKeyRedeemRequest(key=printable, installation_id=installation), session, None,
            _request({"X-Forwarded-For": "181.1.2.3, 10.0.0.1", "User-Agent": "Mozilla/5.0 (Windows NT 10.0) WebView2"}))
        status_request = _request({"Authorization": f"Bearer {redeemed['session_token']}",
                                   "X-GameAccess-Installation": installation, "X-Forwarded-For": "181.1.2.3",
                                   "X-GameAccess-Client": "GameAccess/0.1.0 (windows; PC JUAN-PC)"})
        core.activation_status(status_request, session)
        listed = core.list_access_keys(admin, session)["keys"][0]
        assert listed["last_ip"] == "181.1.2.3"
        assert listed["last_client"] == "GameAccess/0.1.0 (windows; PC JUAN-PC)"
        assert listed["last_seen_at"] is not None and listed["installation_id"] == installation

        core.revoke_access_key(listed["id"], admin, session)
        with pytest.raises(HTTPException):
            core.activation_status(status_request, session)
        assert core.list_access_keys(admin, session)["keys"][0]["revoked_at"] is not None


def test_without_the_secret_the_key_is_not_shown(activation_db, monkeypatch):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "t" * 32)
    admin = _request({"X-GameAccess-Admin-Token": "t" * 32})
    with Session(activation_db) as session:
        core.create_access_keys(core.AccessKeyIssueRequest(duration_hours=12, access_tier="base"), admin, session)
        monkeypatch.setenv("GAMEACCESS_KEY_SECRET", "another secret")   # the secret changed: old keys cannot be read
        assert core.list_access_keys(admin, session)["keys"][0]["key"] is None
