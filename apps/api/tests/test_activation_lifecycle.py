from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

from app import main as core
from app.access_keys import AccessKey, digest, issue_keys, redeem_key, session_end_details, utc, valid_session


@pytest.fixture
def activation_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


def test_twelve_hour_key_is_bound_and_redeeming_does_not_extend_it(activation_db):
    installation = str(uuid4())
    with Session(activation_db) as session:
        key_id, key = issue_keys(session, hours=12, months=None, count=1)[0]
        assert session.get(AccessKey, key_id).key_hash == digest(key.upper())
        token, expires = redeem_key(session, key.lower(), installation)
        row = valid_session(session, token, installation)
        assert row is not None
        assert expires - utc(row.activated_at) == timedelta(hours=12)
        second, second_expiry = redeem_key(session, key, installation)
        assert second_expiry == expires
        assert valid_session(session, token, installation) is None
        assert valid_session(session, second, installation) is not None
        with pytest.raises(ValueError, match="another installation"):
            redeem_key(session, key, str(uuid4()))


def test_pending_key_expires_and_revocation_blocks_redemption_and_session(activation_db):
    installation = str(uuid4())
    with Session(activation_db) as session:
        pending_id, pending = issue_keys(session, hours=12, months=None, count=1)[0]
        row = session.get(AccessKey, pending_id)
        row.key_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.add(row)
        session.commit()
        with pytest.raises(ValueError, match="key has expired"):
            redeem_key(session, pending, installation)
        key_id, key = issue_keys(session, hours=None, months=1, count=1)[0]
        token, _ = redeem_key(session, key, installation)
        row = session.get(AccessKey, key_id)
        row.revoked_at = datetime.now(timezone.utc)
        session.add(row)
        session.commit()
        assert valid_session(session, token, installation) is None
        assert session_end_details(session, token, installation)["reason"] == "revoked"
        assert session_end_details(session, token, str(uuid4())) == {"reason": "unavailable"}
        with pytest.raises(ValueError, match="unavailable"):
            redeem_key(session, key, installation)


@pytest.mark.parametrize("path", ["/catalog", "/games/1/play", "/leases", "/downloads"])
def test_expired_key_denies_protected_requests(activation_db, monkeypatch, tmp_path, path):
    monkeypatch.setattr(core, "engine", activation_db)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(tmp_path / "absent.json"))
    installation = str(uuid4())
    with Session(activation_db) as session:
        key_id, key = issue_keys(session, hours=12, months=None, count=1)[0]
        token, _ = redeem_key(session, key, installation)
        row = session.get(AccessKey, key_id)
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.add(row)
        session.commit()
        assert valid_session(session, token, installation) is None
        assert session_end_details(session, token, installation)["reason"] == "expired"
    client = TestClient(core.app)  # No lifespan: no runtime startup or live services.
    response = client.get(path, headers={"Authorization": f"Bearer {token}", "X-GameAccess-Installation": installation})
    assert response.status_code == 401


def test_admin_issuance_activation_and_revocation_report_server_dates(activation_db, monkeypatch, tmp_path):
    from fastapi import HTTPException, Request
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(tmp_path / "absent.json"))
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "t" * 32)
    admin = Request({"type": "http", "headers": [(b"x-gameaccess-admin-token", b"t" * 32)]})
    installation = str(uuid4())
    with Session(activation_db) as session:
        issued = core.create_access_keys(core.AccessKeyIssueRequest(duration_hours=12), admin, session)
        key = issued["keys"][0]
        result = core.redeem_access_key(core.AccessKeyRedeemRequest(key=key["key"], installation_id=installation), session)
        request = Request({"type": "http", "headers": [
            (b"authorization", f"Bearer {result['session_token']}".encode()),
            (b"x-gameaccess-installation", installation.encode()),
        ]})
        assert core.activation_status(request, session)["active"] is True
        core.revoke_access_key(key["id"], admin, session)
        with pytest.raises(HTTPException) as rejected:
            core.activation_status(request, session)
        assert rejected.value.status_code == 401
        assert rejected.value.detail["reason"] == "revoked"
        assert rejected.value.detail["revoked_at"]
        assert rejected.value.detail["expires_at"]
        assert valid_session(session, result["session_token"], installation) is None
