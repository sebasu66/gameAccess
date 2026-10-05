from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi import HTTPException, Request, Response
from sqlmodel import Session, SQLModel, create_engine
from app import main as core
from app.access_keys import AccessKey, digest

def request(headers=()):
    return Request({"type": "http", "headers": headers})

def test_admin_can_edit_central_passwords_and_requires_admin_token(tmp_path, monkeypatch):
    token = "a" * 40
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", token)
    monkeypatch.setenv("GAMEACCESS_ARCHIVE_PASSWORD_FILE", str(tmp_path / "contraseñas_zip"))
    admin = request([(b"x-gameaccess-admin-token", token.encode())])
    response = Response()
    result = core.admin_save_archive_passwords(core.ArchivePasswordsRequest(passwords="first\nsecond\nfirst\n"), admin, response)
    assert result == {"ok": True, "count": 2}
    assert core.admin_archive_passwords(admin, response)["passwords"] == "first\nsecond"
    assert response.headers["Cache-Control"] == "no-store"
    with pytest.raises(HTTPException) as error:
        core.admin_archive_passwords(request(), Response())
    assert error.value.status_code == 403

def test_client_passwords_require_activation_and_are_delivered_in_order(tmp_path, monkeypatch):
    monkeypatch.setenv("GAMEACCESS_ARCHIVE_PASSWORD_FILE", str(tmp_path / "contraseñas_zip"))
    core.save_archive_passwords("one\ntwo\n")
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    SQLModel.metadata.create_all(engine)
    installation = str(uuid4())
    token = "fixture-session"
    now = core.now_utc()
    with Session(engine) as session:
        session.add(AccessKey(key_hash=digest("fixture-key"), duration_hours=1, created_at=now,
            key_expires_at=now+timedelta(hours=1), activated_at=now, expires_at=now+timedelta(hours=1),
            installation_id=installation, session_hash=digest(token)))
        session.commit()
        client = request([(b"authorization", f"Bearer {token}".encode()), (b"x-gameaccess-installation", installation.encode())])
        response = Response()
        assert core.client_archive_passwords(client, response, session) == {"passwords": ["one", "two"]}
        assert response.headers["Cache-Control"] == "no-store"
        with pytest.raises(HTTPException) as error:
            core.client_archive_passwords(request(), Response(), session)
        assert error.value.status_code == 401

def test_empty_list_and_invalid_password_lengths(tmp_path, monkeypatch):
    monkeypatch.setenv("GAMEACCESS_ARCHIVE_PASSWORD_FILE", str(tmp_path / "contraseñas_zip"))
    assert core.read_archive_passwords() == []
    with pytest.raises(ValueError):
        core.save_archive_passwords("x" * 1025)
def local_request(extra_headers=(), client_host="127.0.0.1", host="127.0.0.1:38147"):
    return Request({"type": "http", "scheme": "http", "path": "/admin/archive-passwords",
        "client": (client_host, 50000), "server": ("127.0.0.1", 38147),
        "headers": [(b"host", host.encode()), *extra_headers]})

def test_local_editor_can_load_and_save_without_admin_token(tmp_path, monkeypatch):
    monkeypatch.delenv("GAMEACCESS_ADMIN_TOKEN", raising=False)
    monkeypatch.setenv("GAMEACCESS_ARCHIVE_PASSWORD_FILE", str(tmp_path / "contraseñas_zip"))
    local = local_request([(b"origin", b"http://127.0.0.1:38147")])
    response = Response()
    assert core.admin_archive_passwords(local, response)["count"] == 0
    assert core.admin_save_archive_passwords(core.ArchivePasswordsRequest(passwords="first\nsecond"), local, response)["count"] == 2
    assert core.admin_archive_passwords(local, response)["passwords"] == "first\nsecond"

@pytest.mark.parametrize("local", [
    local_request(client_host="192.0.2.20"),
    local_request(host="hosted.example"),
    local_request([(b"x-forwarded-for", b"192.0.2.20")]),
    local_request([(b"origin", b"https://external.example")]),
])
def test_remote_or_forwarded_requests_still_require_admin_token(local, monkeypatch):
    monkeypatch.delenv("GAMEACCESS_ADMIN_TOKEN", raising=False)
    with pytest.raises(HTTPException) as error:
        core.admin_archive_passwords(local, Response())
    assert error.value.status_code == 503

def test_local_editor_does_not_require_configured_token(monkeypatch, tmp_path):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "configured-server-token" * 2)
    monkeypatch.setenv("GAMEACCESS_ARCHIVE_PASSWORD_FILE", str(tmp_path / "contraseñas_zip"))
    assert core.admin_archive_passwords(local_request(host="localhost:38147"), Response())["count"] == 0

