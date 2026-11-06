from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import admin_auth, support
from app.api_dependencies import get_session
from app.main import app
from app.support import SupportMessage


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session
    monkeypatch.setattr(support, "engine", engine)
    monkeypatch.setattr(support, "_requests", {})
    monkeypatch.setattr(support, "notify", lambda *args, **kwargs: False)
    mailed = []
    monkeypatch.setattr(support, "send_mail", lambda row: mailed.append(row.id) or True)
    with TestClient(app) as test_client:
        test_client.engine = engine
        test_client.mailed = mailed
        yield test_client
    app.dependency_overrides.pop(get_session, None)


def write(client, installation=None, **body):
    payload = {"subject": "No baja", "message": "Hades se queda en 3 %", "email": "jugador@ejemplo.com", **body}
    return client.post("/support/messages", json=payload, headers={"X-GameAccess-Installation": installation or str(uuid4())})


def test_a_base_player_writes_without_a_key_and_the_message_is_kept_and_mailed(client):
    response = write(client, name="Laura", log=r"C:\Users\Laura\AppData\x.log falló")
    assert response.status_code == 200
    with Session(client.engine) as session:
        row = session.get(SupportMessage, response.json()["id"])
    assert row.subject == "No baja" and row.email == "jugador@ejemplo.com" and row.name == "Laura"
    assert "Laura" not in row.log and r"C:\Users\[user]" in row.log
    assert client.mailed == [row.id] and row.mailed_at is not None


def test_bad_requests_are_refused(client):
    assert client.post("/support/messages", json={"subject": "a", "message": "b"}).status_code == 400
    assert write(client, email="no-es-un-correo").status_code == 422
    assert write(client, message="   ").status_code == 422


def test_one_installation_cannot_flood_the_mailbox(client):
    player = str(uuid4())
    assert [write(client, player).status_code for _ in range(6)] == [200] * 5 + [429]


def test_only_the_administrator_reads_and_marks_messages(client, monkeypatch):
    message_id = write(client).json()["id"]
    assert client.get("/admin/support-messages").status_code in (401, 403, 503)
    monkeypatch.setattr(admin_auth, "admin_authenticated", lambda request: True)
    monkeypatch.setattr(support, "_admin_activation_access", lambda request: None)
    first, = client.get("/admin/support-messages").json()["messages"]
    assert first["id"] == message_id and first["read_at"] is None
    assert client.post(f"/admin/support-messages/{message_id}/read").json()["read_at"] is not None


def test_the_mail_goes_to_support_with_the_player_as_reply_to(monkeypatch):
    sent = {}

    def post(url, json, headers, timeout):
        sent.update(url=url, json=json, headers=headers)
        return httpx.Response(200)

    row = SupportMessage(id=7, created_at=support.now_utc(), installation_id=str(uuid4()), name="Laura",
                         email="jugador@ejemplo.com", subject="No baja", message="Hades se queda en 3 %")
    monkeypatch.delenv("GAMEACCESS_RESEND_API_KEY", raising=False)
    assert support.send_mail(row, post=post) is False and sent == {}
    monkeypatch.setenv("GAMEACCESS_RESEND_API_KEY", "re_test")
    assert support.send_mail(row, post=post) is True
    assert sent["json"]["to"] == ["game-access-contacto@proton.me"] and sent["json"]["reply_to"] == "jugador@ejemplo.com"
    assert sent["json"]["subject"] == "[Game Access] No baja" and "Hades se queda en 3 %" in sent["json"]["text"]
    assert sent["headers"]["Authorization"] == "Bearer re_test"
