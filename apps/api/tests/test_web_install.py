import httpx
import pytest
from fastapi.testclient import TestClient

from app import web_install
from app.main import app

SHA = "ab" * 32


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(web_install, "_sessions", {})
    monkeypatch.setattr(web_install, "_created", {})
    monkeypatch.setattr(web_install, "_release", {})
    monkeypatch.setenv("GAMEACCESS_PUBLIC_API_URL", "https://api.example.test/")
    monkeypatch.setenv("GAMEACCESS_WEB_INSTALL_URL", "https://cdn.example.test/gameAccess_0.1.9_x64-setup.exe")
    monkeypatch.setenv("GAMEACCESS_WEB_INSTALL_SHA256", SHA)
    monkeypatch.setenv("GAMEACCESS_WEB_INSTALL_VERSION", "0.1.9")
    with TestClient(app) as test_client:
        yield test_client


def test_a_session_gives_a_short_code_and_its_command(client):
    body = client.post("/install/sessions").json()
    assert web_install._CODE.match(body["code"])
    assert body["command"] == f'powershell -nop -c "irm https://api.example.test/i/{body["code"]}|iex"'
    assert len(body["command"]) < 259  # what Win + R takes


def test_the_script_carries_the_session_and_the_verified_release(client):
    code = client.post("/install/sessions").json()["code"]
    response = client.get(f"/i/{code.lower()}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    script = response.text
    assert "$Api = 'https://api.example.test'" in script
    assert f"$Code = '{code}'" in script
    assert f"$InstallerSha256 = '{SHA}'" in script
    assert "$Version = '0.1.9'" in script
    assert "__URL__" not in script
    assert client.get(f"/install/sessions/{code}").json()["fetched"] is True


def test_an_unknown_code_answers_a_harmless_message(client):
    response = client.get("/i/ZZZZZZ")
    assert response.status_code == 200
    assert response.text.startswith("Write-Host 'Este codigo")


def test_values_are_quoted_for_powershell(monkeypatch, client):
    monkeypatch.setenv("GAMEACCESS_WEB_INSTALL_URL", "https://x.test/a'; Remove-Item C:\\ ;'.exe")
    code = client.post("/install/sessions").json()["code"]
    assert "$InstallerUrl = 'https://x.test/a''; Remove-Item C:\\ ;''.exe'" in client.get(f"/i/{code}").text


def test_events_build_the_state_the_page_shows(client):
    code = client.post("/install/sessions").json()["code"]
    for event in ({"step": "connected", "state": "ok"},
                  {"step": "download", "state": "running", "detail": "12/36", "progress": 33},
                  {"step": "download", "state": "ok", "progress": 100},
                  {"step": "open", "state": "ok"}):
        assert client.post(f"/install/sessions/{code}/events", json=event).status_code == 200
    state = client.get(f"/install/sessions/{code}").json()
    assert state["steps"]["download"] == {"state": "ok", "detail": "", "progress": 100}
    assert state["done"] is True and state["failed"] is False
    assert state["order"][0] == "connected"


def test_events_only_take_known_steps_and_states(client):
    code = client.post("/install/sessions").json()["code"]
    assert client.post(f"/install/sessions/{code}/events", json={"step": "rm", "state": "ok"}).status_code == 422
    assert client.post(f"/install/sessions/{code}/events", json={"step": "open", "state": "maybe"}).status_code == 422
    assert client.post("/install/sessions/ZZZZZZ/events", json={"step": "open", "state": "ok"}).status_code == 404


def test_an_error_marks_the_session_failed(client):
    code = client.post("/install/sessions").json()["code"]
    client.post(f"/install/sessions/{code}/events", json={"step": "install", "state": "error", "detail": "uac_declined"})
    state = client.get(f"/install/sessions/{code}").json()
    assert state["failed"] is True and state["steps"]["install"]["detail"] == "uac_declined"


def test_sessions_expire(monkeypatch, client):
    code = client.post("/install/sessions").json()["code"]
    web_install._sessions[code]["created"] -= web_install.SESSION_SECONDS + 1
    assert client.get(f"/install/sessions/{code}").status_code == 404


def test_one_address_cannot_flood_sessions(monkeypatch, client):
    monkeypatch.setattr(web_install, "SESSIONS_PER_HOUR", 2)
    assert client.post("/install/sessions").status_code == 200
    assert client.post("/install/sessions").status_code == 200
    assert client.post("/install/sessions").status_code == 429


def test_without_a_digest_nothing_is_offered(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_WEB_INSTALL_URL", raising=False)
    monkeypatch.setattr(web_install, "_release", {})
    release = {"tag_name": "gameaccess-v0.1.3", "assets": [
        {"name": "gameAccess_0.1.3_x64-setup.exe", "browser_download_url": "https://github.com/x.exe"}]}
    monkeypatch.setattr(web_install.httpx, "get", lambda *a, **k: httpx.Response(200, json=release, request=httpx.Request("GET", "https://x")))
    assert web_install.latest_release() == {}


def test_the_latest_release_comes_with_its_digest(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_WEB_INSTALL_URL", raising=False)
    monkeypatch.setattr(web_install, "_release", {})
    release = {"tag_name": "gameaccess-v0.1.3", "assets": [
        {"name": "latest.json", "browser_download_url": "https://github.com/latest.json", "digest": f"sha256:{SHA}"},
        {"name": "gameAccess_0.1.3_x64-setup.exe", "browser_download_url": "https://github.com/x.exe", "digest": f"sha256:{SHA}"}]}
    monkeypatch.setattr(web_install.httpx, "get", lambda *a, **k: httpx.Response(200, json=release, request=httpx.Request("GET", "https://x")))
    assert web_install.latest_release() == {"url": "https://github.com/x.exe", "sha256": SHA, "version": "0.1.3"}


def test_local_installer_files_are_served_only_when_configured(monkeypatch, tmp_path, client):
    (tmp_path / "gameAccess_0.1.9_x64-setup.exe").write_bytes(b"MZ")
    assert client.get("/setup/gameAccess_0.1.9_x64-setup.exe").status_code == 404
    monkeypatch.setenv("GAMEACCESS_WEB_INSTALL_FILES", str(tmp_path))
    assert client.get("/setup/gameAccess_0.1.9_x64-setup.exe").content == b"MZ"
    assert client.get("/setup/..%5Cmain.py").status_code == 404
