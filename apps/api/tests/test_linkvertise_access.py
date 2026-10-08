from datetime import timedelta
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool
from app import main as core
from app import linkvertise_access as flow
from app.access_keys import AccessKey

HASH = "a" * 64

@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    monkeypatch.setenv("GAMEACCESS_LINKVERTISE_URL", "https://linkvertise.com/123/test")
    monkeypatch.setenv("GAMEACCESS_LINKVERTISE_ANTI_BYPASS_TOKEN", "b" * 64)
    def sessions():
        with Session(engine) as session:
            yield session
    core.app.dependency_overrides[core.get_session] = sessions
    yield TestClient(core.app), engine
    core.app.dependency_overrides.pop(core.get_session, None)
    engine.dispose()


def test_verified_completion_issues_only_one_twelve_hour_key(client, monkeypatch):
    browser, engine = client
    async def verified(token, completion_hash):
        assert token == "b" * 64
        assert completion_hash == HASH
        return True
    monkeypatch.setattr(flow, "verify_completion", verified)
    result = browser.get("/activation/free/return", params={"hash": HASH})
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store, private"
    assert "GA-" in result.text
    assert browser.get("/activation/free/return", params={"hash": HASH}).status_code == 409
    with Session(engine) as session:
        rows = session.exec(select(AccessKey)).all()
        assert len(rows) == 1
        assert rows[0].duration_hours == 12
        assert rows[0].activated_at is None
        assert rows[0].key_expires_at - rows[0].created_at == timedelta(hours=24)


def test_forged_confirmation_and_missing_hash_cannot_issue_keys(client, monkeypatch):
    browser, engine = client
    async def rejected(token, completion_hash):
        return False
    monkeypatch.setattr(flow, "verify_completion", rejected)
    assert browser.get("/activation/free/return", params={"hash": HASH}).status_code == 403
    assert browser.get("/activation/free/return").status_code == 403
    with Session(engine) as session:
        assert session.exec(select(AccessKey)).all() == []
        assert session.exec(select(flow.LinkvertiseCompletion)).all() == []


def test_unconfigured_provider_is_disabled_and_start_warms_before_redirect(client, monkeypatch):
    browser, _ = client
    assert browser.get("/activation/free/config").json() == {"configured": True}
    start = browser.get("/activation/free/start", follow_redirects=False)
    assert start.status_code == 303
    assert start.headers["location"] == "https://linkvertise.com/123/test"
    monkeypatch.delenv("GAMEACCESS_LINKVERTISE_ANTI_BYPASS_TOKEN")
    assert browser.get("/activation/free/config").json() == {"configured": False}
    assert browser.get("/activation/free/start").status_code == 503
    assert browser.get("/activation/free/return", params={"hash": HASH}).status_code == 503


@pytest.mark.parametrize("payload, expected", [("TRUE", True), ("FALSE", False), ("Invalid token.", False), ("<html>loading</html>", False)])
def test_provider_protocol_accepts_only_true_and_fails_closed(monkeypatch, payload, expected):
    import asyncio
    import httpx
    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs == {"timeout": 4.0, "follow_redirects": False}
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def post(self, url, params):
            assert url == "https://publisher.linkvertise.com/api/v1/anti_bypassing"
            assert params == {"token": "b" * 64, "hash": HASH}
            return httpx.Response(200, text=payload)
    monkeypatch.setattr(flow.httpx, "AsyncClient", FakeClient)
    assert asyncio.run(flow.verify_completion("b" * 64, HASH)) is expected


def test_provider_timeout_fails_closed(monkeypatch):
    import asyncio
    import httpx
    class TimeoutClient:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def post(self, *args, **kwargs): raise httpx.ReadTimeout("synthetic timeout")
    monkeypatch.setattr(flow.httpx, "AsyncClient", TimeoutClient)
    assert asyncio.run(flow.verify_completion("b" * 64, HASH)) is False
