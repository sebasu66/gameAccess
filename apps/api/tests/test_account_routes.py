"""A player's own account (L3): register and sign in from the app; the PLUS key of that PC is tied to it."""
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import account_routes
from app.access_keys import AccessKey, issue_keys, redeem_key, utc
from app.accounts import Account, now_utc
from app.api_dependencies import get_session
from app.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "t" * 32)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(tmp_path / "absent.json"))
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session
    monkeypatch.setattr(account_routes, "_attempts", {})
    with TestClient(app) as test_client:
        test_client.engine = engine
        yield test_client
    app.dependency_overrides.pop(get_session, None)


def headers(installation, token=None):
    return {"X-GameAccess-Installation": installation, **({"Authorization": f"Bearer {token}"} if token else {})}


def register(client, installation, email="laura@ejemplo.com", password="clave-segura"):
    return client.post("/accounts/register", json={"name": "Laura", "email": email, "password": password}, headers=headers(installation))


def test_register_sign_in_and_out(client):
    pc = str(uuid4())
    first = register(client, pc)
    assert first.status_code == 200 and first.json()["account"] == {"name": "Laura", "email": "laura@ejemplo.com", "language": "es", "plus_active": False, "plus_until": None}
    token = first.json()["token"]
    assert client.get("/accounts/me", headers=headers(pc, token)).json()["name"] == "Laura"
    with Session(client.engine) as session:
        row = session.exec(account_routes.select(account_routes.AccountSession)).one()
    assert token not in row.token_hash                                   # only the token's hash is kept
    assert client.post("/accounts/logout", headers=headers(pc, token)).status_code == 200
    assert client.get("/accounts/me", headers=headers(pc, token)).status_code == 401
    again = client.post("/accounts/login", json={"email": " Laura@Ejemplo.com ", "password": "clave-segura"}, headers=headers(pc))
    assert again.status_code == 200 and client.get("/accounts/me", headers=headers(pc, again.json()["token"])).status_code == 200


def test_bad_registrations_and_passwords_are_refused(client):
    pc = str(uuid4())
    assert register(client, pc).status_code == 200
    assert register(client, pc).status_code == 409                        # the email is taken
    assert register(client, pc, email="otra@ejemplo.com", password="corta").status_code == 422
    assert register(client, pc, email="no-es-correo").status_code == 422
    assert client.post("/accounts/register", json={"name": "Laura", "email": "x@ejemplo.com", "password": "clave-segura"}).status_code == 400
    wrong = client.post("/accounts/login", json={"email": "laura@ejemplo.com", "password": "otra-clave"}, headers=headers(pc))
    assert wrong.status_code == 401 and wrong.json()["detail"] == "bad_credentials"
    assert client.post("/accounts/login", json={"email": "nadie@ejemplo.com", "password": "clave-segura"}, headers=headers(pc)).status_code == 401


def test_guessing_passwords_is_slowed_down(client):
    pc = str(uuid4())
    register(client, pc)
    tries = [client.post("/accounts/login", json={"email": "laura@ejemplo.com", "password": f"mala-{i}-clave"}, headers=headers(pc)).status_code for i in range(11)]
    assert tries == [401] * 10 + [429]


def test_the_plus_key_of_this_pc_is_tied_to_the_account_without_shortening_it(client):
    pc = str(uuid4())
    with Session(client.engine) as session:
        [(key_id, printable)] = issue_keys(session, hours=None, months=1, count=1, access_tier="plus", label="beta")
        redeem_key(session, printable, pc)
        ends = utc(session.get(AccessKey, key_id).expires_at)
    body = register(client, pc).json()["account"]
    assert body["plus_active"] is True
    with Session(client.engine) as session:
        key = session.get(AccessKey, key_id)
        account = session.get(Account, key.account_id)
        assert account.email == "laura@ejemplo.com" and utc(key.expires_at) == ends and utc(account.plus_until) == ends
    # A key activated later, while signed in, is tied by link-installation.
    other_pc = str(uuid4())
    token = client.post("/accounts/login", json={"email": "laura@ejemplo.com", "password": "clave-segura"}, headers=headers(other_pc)).json()["token"]
    with Session(client.engine) as session:
        [(second_id, second)] = issue_keys(session, hours=None, months=2, count=1, access_tier="plus", label="beta")
        redeem_key(session, second, other_pc)
    linked = client.post("/accounts/link-installation", headers=headers(other_pc, token)).json()
    assert linked["linked"] == 1
    with Session(client.engine) as session:
        account = session.get(Account, session.get(AccessKey, second_id).account_id)
        assert utc(account.plus_until) > ends + timedelta(days=20)          # the longer key wins
        assert utc(session.get(AccessKey, key_id).expires_at) == utc(account.plus_until) > now_utc()
