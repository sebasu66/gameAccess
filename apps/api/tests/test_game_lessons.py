import hashlib
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import admin_auth, game_lessons
from app.api_dependencies import get_session
from app.game_lessons import GameLessonReport
from app.main import app
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
    monkeypatch.setattr(game_lessons, "_requests", {})
    monkeypatch.delenv("GAMEACCESS_LESSON_MIN_REPORTS", raising=False)
    with TestClient(app) as test_client:
        test_client.engine = engine
        yield test_client
    app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def admin(monkeypatch):
    monkeypatch.setattr(admin_auth, "admin_authenticated", lambda request: True)
    monkeypatch.setattr(game_lessons, "_admin_activation_access", lambda request: None)


def report(client, installation=None, **body):
    payload = {"kind": "bad_source", "scope": "source", "subject": FP, "reason": "not_a_game", "app_id": 10, "detail": ["audio", "images"], **body}
    return client.post("/game-lessons/report", json=payload, headers={"X-GameAccess-Installation": installation or str(uuid4())})


def lessons(client, since=0):
    return client.get("/game-lessons", params={"since": since}).json()


def test_one_report_is_not_enough_and_the_same_player_counts_once(client):
    player = str(uuid4())
    assert report(client, player).json() == {"ok": True, "counted": True}
    assert report(client, player).json() == {"ok": True, "counted": False}
    assert lessons(client)["lessons"] == []

    assert report(client).json()["counted"] is True
    lesson, = lessons(client)["lessons"]
    assert lesson["kind"] == "bad_source" and lesson["scope"] == "source" and lesson["subject"] == FP
    assert lesson["reason"] == "not_a_game" and lesson["action"] == "avoid" and lesson["reports"] == 2
    assert lesson["confidence"] == "flagged" and lesson["app_id"] == 10 and lesson["detail"] == ["audio", "images"]


def test_no_personal_data_is_kept(client):
    player = str(uuid4())
    report(client, player)
    with Session(client.engine) as session:
        row = session.exec(select(GameLessonReport)).one()
    assert player not in row.voter and len(row.voter) == 32


def test_players_report_bad_sources_only_and_never_addresses(client):
    assert report(client, subject="magnet:?xt=urn:btih:" + "a" * 40).status_code == 422
    assert report(client, scope="provider", subject="https://example.com/x").status_code == 422
    assert report(client, reason="i_dont_like_it").status_code == 422
    assert report(client, kind="abandoned", scope="game", subject="10", reason="dropped").status_code == 422
    assert client.post("/game-lessons/report", json={"subject": FP, "reason": "not_a_game"}).status_code == 400


def test_threshold_is_configurable_and_many_reports_confirm(client, monkeypatch):
    monkeypatch.setenv("GAMEACCESS_LESSON_MIN_REPORTS", "1")
    report(client, scope="provider", subject="  Some  Provider ")
    lesson, = lessons(client)["lessons"]
    assert lesson["subject"] == "some provider" and lesson["confidence"] == "flagged"
    report(client, scope="provider", subject="some provider")
    assert lessons(client)["lessons"][0]["confidence"] == "confirmed"


def test_clients_get_a_snapshot_then_only_what_changed(client, admin):
    report(client); report(client)
    first = lessons(client)
    assert first["full"] is True and len(first["lessons"]) == 1
    assert lessons(client, first["revision"]) == {"revision": first["revision"], "full": False, "lessons": [], "removed": [], "min_reports": 2}

    body = {"kind": "how_to_run", "scope": "game", "subject": "1245620", "reason": "run_as_admin", "action": "note", "text": "Correr como administrador."}
    assert client.post("/admin/game-lessons", json=body).status_code == 200
    delta = lessons(client, first["revision"])
    assert delta["full"] is False and delta["revision"] > first["revision"]
    lesson, = delta["lessons"]
    assert lesson["kind"] == "how_to_run" and lesson["app_id"] == 1245620 and lesson["text"] == "Correr como administrador."
    assert lesson["confidence"] == "confirmed" and lesson["reports"] == 0

    assert client.post("/admin/game-lessons", json={**body, "retract": True}).status_code == 200
    taken_back = lessons(client, delta["revision"])
    assert taken_back["lessons"] == [] and taken_back["removed"] == [{"kind": "how_to_run", "scope": "game", "subject": "1245620", "reason": "run_as_admin"}]
    assert len(lessons(client)["lessons"]) == 1


def test_an_abandoned_game_is_a_lesson_about_the_game(client, admin):
    body = {"kind": "abandoned", "scope": "game", "subject": "730", "reason": "developer_dropped", "action": "discard"}
    assert client.post("/admin/game-lessons", json=body).status_code == 200
    assert client.post("/admin/game-lessons", json={**body, "scope": "source", "subject": FP}).status_code == 422
    lesson, = lessons(client)["lessons"]
    assert lesson["action"] == "discard" and lesson["app_id"] == 730


def test_too_many_reports_from_one_address(client, monkeypatch):
    monkeypatch.setattr(game_lessons, "REPORTS_PER_HOUR", 1)
    assert report(client).status_code == 200
    assert report(client).status_code == 429


def test_admin_route_requires_the_administrator(client):
    assert client.post("/admin/game-lessons", json={"subject": FP, "reason": "not_a_game"}).status_code == 401


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
    assert normalize_source_url(url).fingerprint == hashlib.sha256(identity.encode()).hexdigest()
