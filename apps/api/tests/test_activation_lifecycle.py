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
        assert result["cacheable"] is True
        status = core.activation_status(request, session)
        assert status["active"] is True
        assert status["cacheable"] is True
        core.revoke_access_key(key["id"], admin, session)
        with pytest.raises(HTTPException) as rejected:
            core.activation_status(request, session)
        assert rejected.value.status_code == 401
        assert rejected.value.detail["reason"] == "revoked"
        assert rejected.value.detail["revoked_at"]
        assert rejected.value.detail["expires_at"]
        assert valid_session(session, result["session_token"], installation) is None

def test_courtesy_redemption_and_status_are_never_cacheable(activation_db, monkeypatch, tmp_path):
    import json
    from fastapi import Request, Response
    key = "GA-PRIVATE-FIXTURE-1234"
    config = tmp_path / "courtesy-keys.json"
    config.write_text(json.dumps({"keys": [{"name": "tester", "key": key, "duration_months": 1}]}))
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(config))
    installation = str(uuid4())
    with Session(activation_db) as session:
        reply = Response()
        result = core.redeem_access_key(core.AccessKeyRedeemRequest(key=key, installation_id=installation), session, reply)
        assert reply.headers["cache-control"] == "no-store"
        assert result["cacheable"] is False
        request = Request({"type": "http", "headers": [
            (b"authorization", f"Bearer {result['session_token']}".encode()),
            (b"x-gameaccess-installation", installation.encode()),
        ]})
        reply = Response()
        status = core.activation_status(request, session, reply)
        assert reply.headers["cache-control"] == "no-store"
        assert status["active"] is True
        assert status["cacheable"] is False
        assert key not in repr(result) + repr(status)

def test_absolute_plus_expiry_manual_renewal_and_revocation(activation_db, monkeypatch, tmp_path):
    from fastapi import Request, HTTPException
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "t" * 32)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(tmp_path / "absent.json"))
    admin = Request({"type": "http", "headers": [(b"x-gameaccess-admin-token", b"t" * 32)]})
    installation = str(uuid4())
    expiry = datetime.now(timezone.utc) + timedelta(days=30)
    with Session(activation_db) as session:
        result = core.create_access_keys(core.AccessKeyIssueRequest(expires_at=expiry, access_tier="plus"), admin, session)
        key = result["keys"][0]
        redeemed = core.redeem_access_key(core.AccessKeyRedeemRequest(key=key["key"], installation_id=installation), session)
        assert redeemed["access_tier"] == "plus"
        assert utc(redeemed["expires_at"]) == expiry
        request = Request({"type": "http", "headers": [
            (b"authorization", f"Bearer {redeemed['session_token']}".encode()),
            (b"x-gameaccess-installation", installation.encode()),
        ]})
        extended = expiry + timedelta(days=31)
        core.renew_access_key(key["id"], core.AccessKeyRenewRequest(expires_at=extended), admin, session)
        assert core.activation_status(request, session)["expires_at"] == extended
        with pytest.raises(HTTPException) as denied:
            core.renew_access_key(key["id"], core.AccessKeyRenewRequest(expires_at=expiry), admin, session)
        assert denied.value.status_code == 409
        core.revoke_access_key(key["id"], admin, session)
        with pytest.raises(HTTPException):
            core.renew_access_key(key["id"], core.AccessKeyRenewRequest(expires_at=extended + timedelta(days=31)), admin, session)
        with pytest.raises(HTTPException):
            core.activation_status(request, session)


def test_expired_plus_can_be_renewed_but_base_and_unauthorized_cannot(activation_db, monkeypatch):
    from fastapi import Request, HTTPException
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "t" * 32)
    admin = Request({"type": "http", "headers": [(b"x-gameaccess-admin-token", b"t" * 32)]})
    stranger = Request({"type": "http", "headers": []})
    with Session(activation_db) as session:
        key_id, key = issue_keys(session, hours=None, months=1, count=1)[0]
        row = session.get(AccessKey, key_id)
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        session.add(row)
        session.commit()
        target = datetime.now(timezone.utc) + timedelta(days=30)
        with pytest.raises(HTTPException) as denied:
            core.renew_access_key(key_id, core.AccessKeyRenewRequest(expires_at=target), stranger, session)
        assert denied.value.status_code == 403
        core.renew_access_key(key_id, core.AccessKeyRenewRequest(expires_at=target), admin, session)
        token, restored_expiry = redeem_key(session, key, str(uuid4()))
        assert restored_expiry == target
        assert valid_session(session, token, row.installation_id) is not None
        base_id, _ = issue_keys(session, hours=12, months=None, count=1)[0]
        with pytest.raises(HTTPException) as denied:
            core.renew_access_key(base_id, core.AccessKeyRenewRequest(expires_at=target), admin, session)
        assert denied.value.status_code == 409
        with pytest.raises(HTTPException) as denied:
            core.create_access_keys(core.AccessKeyIssueRequest(expires_at=datetime.now()), admin, session)
        assert denied.value.status_code == 422

def test_legacy_monthly_tier_migration_is_idempotent():
    from sqlalchemy import text
    from app.access_keys import ensure_access_key_schema
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE accesskey (id INTEGER PRIMARY KEY, duration_months INTEGER, key_expires_at TIMESTAMP)"))
        connection.execute(text("INSERT INTO accesskey VALUES (1, 1, NULL), (2, NULL, NULL)"))
    ensure_access_key_schema(engine)
    ensure_access_key_schema(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT access_tier FROM accesskey ORDER BY id")).scalars().all() == ["plus", "base"]
    engine.dispose()
