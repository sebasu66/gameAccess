from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import source_lessons
from app.api_dependencies import get_session
from app.main import app
from app.source_lessons import SourceLessonReport, published_lessons
from app.viking_cache_service import normalize_source_url

FP = "a" * 64


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session
    monkeypatch.setattr(source_lessons, "_requests", {})
    monkeypatch.delenv("GAMEACCESS_LESSON_MIN_REPORTS", raising=False)
    with TestClient(app) as test_client:
        test_client.engine = engine
        yield test_client
    app.dependency_overrides.pop(get_session, None)


def report(client, installation=None, **body):
    payload = {"scope": "source", "subject": FP, "reason": "not_a_game", "app_id": 10, "detail": ["audio", "images"], **body}
    return client.post("/source-lessons/report", json=payload, headers={"X-GameAccess-Installation": installation or str(uuid4())})


def test_one_report_is_not_enough_and_the_same_player_counts_once(client):
    player = str(uuid4())
    assert report(client, player).json() == {"ok": True, "counted": True}
    assert report(client, player).json() == {"ok": True, "counted": False}
    assert client.get("/source-lessons").json()["lessons"] == []

    assert report(client).json()["counted"] is True
    lesson, = client.get("/source-lessons").json()["lessons"]
    assert lesson["scope"] == "source" and lesson["subject"] == FP and lesson["reason"] == "not_a_game"
    assert lesson["action"] == "avoid" and lesson["reports"] == 2 and lesson["confidence"] == "flagged"
    assert lesson["app_id"] == 10 and lesson["detail"] == ["audio", "images"]
    assert lesson["first_seen"] <= lesson["last_seen"]


def test_no_personal_data_is_kept(client):
    player = str(uuid4())
    report(client, player)
    with Session(client.engine) as session:
        row = session.exec(select(SourceLessonReport)).one()
    assert player not in row.voter and len(row.voter) == 32


def test_addresses_and_bad_input_are_refused(client):
    assert report(client, subject="magnet:?xt=urn:btih:" + "a" * 40).status_code == 422
    assert report(client, scope="provider", subject="https://example.com/x").status_code == 422
    assert report(client, scope="game", subject="Elden Ring").status_code == 422
    assert report(client, reason="i_dont_like_it").status_code == 422
    assert client.post("/source-lessons/report", json={"subject": FP, "reason": "not_a_game"}).status_code == 400


def test_threshold_is_configurable_and_many_reports_confirm(client, monkeypatch):
    monkeypatch.setenv("GAMEACCESS_LESSON_MIN_REPORTS", "1")
    report(client, scope="provider", subject="  Some  Provider ")
    lesson, = client.get("/source-lessons").json()["lessons"]
    assert lesson["subject"] == "some provider" and lesson["confidence"] == "flagged"
    report(client, scope="provider", subject="some provider")
    assert client.get("/source-lessons").json()["lessons"][0]["confidence"] == "confirmed"


def test_unchanged_list_answers_with_its_revision_only(client):
    report(client); report(client)
    first = client.get("/source-lessons").json()
    assert client.get("/source-lessons", params={"since": first["revision"]}).json() == {"revision": first["revision"], "unchanged": True}
    report(client)
    assert len(client.get("/source-lessons", params={"since": first["revision"]}).json()["lessons"]) == 1


def test_too_many_reports_from_one_address(client, monkeypatch):
    monkeypatch.setattr(source_lessons, "REPORTS_PER_HOUR", 1)
    assert report(client).status_code == 200
    assert report(client).status_code == 429


def test_an_administrator_lesson_is_published_at_once(client, monkeypatch):
    from app import admin_auth
    monkeypatch.setattr(admin_auth, "admin_authenticated", lambda request: True)
    monkeypatch.setattr(source_lessons, "_admin_activation_access", lambda request: None)
    body = {"scope": "game", "subject": "1245620", "reason": "needs_online_fix", "action": "note"}
    assert client.post("/admin/source-lessons", json=body).status_code == 200
    lesson, = client.get("/source-lessons").json()["lessons"]
    assert lesson["action"] == "note" and lesson["reports"] == 0 and lesson["confidence"] == "confirmed"


def test_admin_route_requires_the_administrator(client):
    assert client.post("/admin/source-lessons", json={"subject": FP, "reason": "not_a_game"}).status_code == 401


def test_published_lessons_by_default_need_two_players():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(SourceLessonReport(scope="source", subject=FP, reason="not_a_game", voter="x", created_at=source_lessons.now_utc()))
        session.commit()
        assert published_lessons(session) == []
        assert len(published_lessons(session, threshold=1)) == 1


# The desktop app computes the same fingerprints (apps/desktop/src/catalog/sourceFingerprint.ts); its test checks
# these exact values, so a change on either side breaks a test.
GOLDEN = {
    "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Game+v1&tr=udp://t.example:80":
        "torrent:urn:btih:abcdef0123456789abcdef0123456789abcdef01",
    "https://Files.Example.com:443/d/Game%20v1.zip?b=2&a=1&token=secret#part":
        "direct:https://files.example.com/d/Game%20v1.zip?a=1&b=2",
    "http://example.com:8080?q=a+b&x=%21":
        "direct:http://example.com:8080/?q=a+b&x=%21",
}


@pytest.mark.parametrize("url,identity", GOLDEN.items())
def test_golden_fingerprints_shared_with_the_desktop_app(url, identity):
    import hashlib
    assert normalize_source_url(url).fingerprint == hashlib.sha256(identity.encode()).hexdigest()
