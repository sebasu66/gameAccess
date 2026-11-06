"""Game Access users (US.1): the membership Seba marks by hand decides PLUS, and the user's keys follow it."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import main as core
from app import account_admin_routes as routes
from app.accounts import Account, check_password, create_account, membership_state, account_keys
from app.api_schemas import AccessKeyRenewRequest, AccountCreateRequest, AccountKeyRequest, AccountMembershipRequest

TOKEN = "t" * 32


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", TOKEN)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(tmp_path / "absent.json"))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


def _request(headers):
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()], "client": ("10.0.0.9", 5000)})


ADMIN = _request({"X-GameAccess-Admin-Token": TOKEN})
now = lambda: datetime.now(timezone.utc)


def test_the_password_is_kept_only_as_a_hash_and_the_email_is_unique(db):
    with Session(db) as session:
        account = create_account(session, email="  Mama@Example.com ", name="Laura", password="clave-segura")
        assert account.email == "mama@example.com"
        assert "clave-segura" not in account.password_hash and account.password_hash.startswith("scrypt$")
        assert check_password(account, "clave-segura") and not check_password(account, "otra-clave")
        with pytest.raises(ValueError, match="email_taken"):
            create_account(session, email="mama@example.com", name="Otra")
        with pytest.raises(ValueError, match="invalid_email"):
            create_account(session, email="sin-arroba", name="Otra")
        listed = routes.list_accounts(ADMIN, session)["accounts"][0]
        assert listed["has_password"] is True
        assert "password_hash" not in listed and "clave-segura" not in str(listed)


def test_the_admin_console_needs_the_administrator(db):
    with Session(db) as session, pytest.raises(HTTPException) as denied:
        routes.list_accounts(_request({"X-GameAccess-Admin-Token": "x" * 32}), session)
    assert denied.value.status_code == 403


def test_the_client_sees_plus_follow_the_payment_marked_by_hand(db):
    installation = str(uuid4())
    with Session(db) as session:
        account = routes.add_account(AccountCreateRequest(email="papa@example.com", name="Pablo"), ADMIN, session)
        until = now() + timedelta(days=30)
        routes.change_membership(account["id"], AccountMembershipRequest(paid=True, plus_until=until, note="Transferencia"), ADMIN, session)
        given = routes.add_account_key(account["id"], AccountKeyRequest(), ADMIN, session)
        printable = given["key"]
        assert given["account"]["state"] == "paid" and given["account"]["keys"][0]["key"] == printable

        redeemed = core.redeem_access_key(core.AccessKeyRedeemRequest(key=printable, installation_id=installation), session, None, None)
        status_request = _request({"Authorization": f"Bearer {redeemed['session_token']}", "X-GameAccess-Installation": installation})
        status = core.activation_status(status_request, session)
        assert status["access_tier"] == "plus"
        # The key runs until the paid date, not a month from its activation.
        assert abs((status["expires_at"] - until).total_seconds()) < 1

        # Not paid: the key ends now and the client hears "expired" (it then pauses kid mode and the key, MN.15).
        routes.change_membership(account["id"], AccountMembershipRequest(paid=False), ADMIN, session)
        with pytest.raises(HTTPException) as ended:
            core.activation_status(status_request, session)
        assert ended.value.status_code == 401 and ended.value.detail["reason"] == "expired"
        assert routes.list_accounts(ADMIN, session)["accounts"][0]["state"] == "unpaid"

        # Paid again: the same PC comes back with the same session, no new key.
        routes.change_membership(account["id"], AccountMembershipRequest(paid=True, plus_until=now() + timedelta(days=31)), ADMIN, session)
        assert core.activation_status(status_request, session)["access_tier"] == "plus"

        # A user's key is renewed on the user, not alone (it would be undone by the next change).
        with pytest.raises(HTTPException) as renew:
            core.renew_access_key(given["account"]["keys"][0]["id"], AccessKeyRenewRequest(expires_at=now() + timedelta(days=90)), ADMIN, session)
        assert renew.value.status_code == 409


def test_a_key_not_activated_yet_also_follows_and_cannot_be_redeemed_unpaid(db):
    with Session(db) as session:
        account = routes.add_account(AccountCreateRequest(email="tia@example.com", name="Tía"), ADMIN, session)
        printable = routes.add_account_key(account["id"], AccountKeyRequest(), ADMIN, session)["key"]
        with pytest.raises(HTTPException):
            core.redeem_access_key(core.AccessKeyRedeemRequest(key=printable, installation_id=str(uuid4())), session, None, None)


def test_linking_an_existing_key_and_what_the_console_calls_each_state(db):
    with Session(db) as session:
        issued = core.create_access_keys(core.AccessKeyIssueRequest(duration_months=1, access_tier="plus"), ADMIN, session)["keys"][0]
        base = core.create_access_keys(core.AccessKeyIssueRequest(duration_hours=12, access_tier="base"), ADMIN, session)["keys"][0]
        account = routes.add_account(AccountCreateRequest(email="abuelo@example.com", name="Abuelo"), ADMIN, session)
        assert account["state"] == "no_key"
        with pytest.raises(HTTPException) as refused:
            routes.add_account_key(account["id"], AccountKeyRequest(key_id=base["id"]), ADMIN, session)
        assert refused.value.status_code == 409
        routes.add_account_key(account["id"], AccountKeyRequest(key_id=issued["id"]), ADMIN, session)
        row = session.get(Account, account["id"])
        keys = account_keys(session, row)
        assert membership_state(row, keys) == "unpaid"
        routes.change_membership(account["id"], AccountMembershipRequest(paid=True, plus_until=now() + timedelta(days=3)), ADMIN, session)
        session.refresh(row)
        assert membership_state(row, keys) == "expiring"
        routes.change_membership(account["id"], AccountMembershipRequest(paid=True, plus_until=now() + timedelta(days=40)), ADMIN, session)
        session.refresh(row)
        assert membership_state(row, keys) == "paid"
        # Paid with a date that already passed is not PLUS.
        assert membership_state(row, keys, now() + timedelta(days=41)) == "unpaid"
        with pytest.raises(HTTPException) as no_date:
            routes.change_membership(account["id"], AccountMembershipRequest(paid=True), ADMIN, session)
        assert no_date.value.status_code == 422
