import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.admin_auth import COOKIE, install_admin_auth

def site():
    app = FastAPI()
    install_admin_auth(app)
    @app.get("/admin-console/")
    def home(): return {"page": "admin"}
    @app.get("/admin/archive-passwords")
    def passwords(): return {"passwords": []}
    @app.post("/admin-console/digital/update")
    def update(): return {"ok": True}
    return app

def test_one_remote_login_authorizes_the_entire_site_and_logout_revokes(monkeypatch):
    token = "remote-admin-fixture-" * 3
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", token)
    with TestClient(site(), base_url="https://hosted.example") as client:
        assert client.get("/admin-console/", follow_redirects=False).status_code == 303
        assert client.get("/admin/archive-passwords").status_code == 401
        assert client.post("/admin-session/login", json={"token": "wrong"}).status_code == 401
        login = client.post("/admin-session/login", json={"token": token})
        assert login.status_code == 200
        assert "HttpOnly" in login.headers["set-cookie"] and "Secure" in login.headers["set-cookie"]
        assert client.get("/admin-console/").status_code == 200
        assert client.get("/admin/archive-passwords").status_code == 200
        assert client.post("/admin-console/digital/update").status_code == 200
        client.post("/admin-session/logout")
        assert client.get("/admin/archive-passwords").status_code == 401

def test_local_entire_site_requires_no_login(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_ADMIN_TOKEN", raising=False)
    with TestClient(site(), base_url="http://127.0.0.1:38147", client=("127.0.0.1", 50000)) as client:
        assert client.get("/admin-console/").status_code == 200
        assert client.get("/admin/archive-passwords").status_code == 200
        assert client.post("/admin-console/digital/update").status_code == 200

def test_cookie_tampering_and_token_rotation_revoke_access(monkeypatch):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "secret-one-" * 5)
    with TestClient(site(), base_url="https://hosted.example") as client:
        client.post("/admin-session/login", json={"token": "secret-one-" * 5})
        original = client.cookies.get(COOKIE)
        client.cookies.clear()
        client.cookies.set(COOKIE, original + "tampered")
        assert client.get("/admin/archive-passwords").status_code == 401
        client.cookies.clear()
        client.cookies.set(COOKIE, original)
        monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "secret-two-" * 5)
        assert client.get("/admin/archive-passwords").status_code == 401
