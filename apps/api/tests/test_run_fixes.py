from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import run_fixes
from app.api_dependencies import get_session
from app.main import app

FIX = {"steam": True, "language": "keep", "runtimes": ["vc2015 x64"], "fixBackup": False, "runAsAdmin": False}


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)

    def session():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session
    monkeypatch.setattr(run_fixes, "_requests", {})
    monkeypatch.delenv("GAMEACCESS_RUNFIX_MIN_REPORTS", raising=False)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(get_session, None)


def report(client, installation=None, app_id=10, fix=None):
    return client.post("/run-fixes/report", json={"app_id": app_id, "fix": fix or FIX}, headers={"X-GameAccess-Installation": installation or str(uuid4())})


def ask(client, app_id=10):
    return client.get(f"/run-fixes/{app_id}", headers={"X-GameAccess-Installation": str(uuid4())}).json()


def test_a_fix_is_offered_once_enough_installations_agree(client):
    assert report(client).json()["counted"] is True
    assert ask(client)["fix"] is None
    report(client)
    answer = ask(client)
    assert answer["fix"] == {"steam": True, "language": "keep", "runtimes": ["vc2015 x64"], "fixBackup": False, "runAsAdmin": False}
    assert answer["reports"] == 2


def test_the_same_installation_counts_once(client):
    same = str(uuid4())
    assert report(client, same).json()["counted"] is True
    assert report(client, same).json()["counted"] is False
    assert ask(client)["fix"] is None


def test_only_known_switches_are_accepted(client):
    assert report(client, fix={**FIX, "runtimes": ["calc.exe"]}).status_code == 422
    assert report(client, fix={**FIX, "language": "spanish"}).status_code == 422
    assert report(client, fix={"steam": False}).status_code == 422


def test_each_game_has_its_own_fixes(client):
    report(client, app_id=11)
    report(client, app_id=11)
    assert ask(client, 11)["fix"] is not None
    assert ask(client, 12)["fix"] is None
