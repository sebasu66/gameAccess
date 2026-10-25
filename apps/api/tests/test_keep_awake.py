import threading

import httpx

from app import keep_awake


class Answer:
    def __init__(self, status):
        self.status_code = status


def test_it_pings_its_own_public_address_on_each_interval():
    asked = []
    stop = threading.Event()

    def get(url, timeout):
        asked.append(url)
        if len(asked) == 3:
            stop.set()
        return Answer(200)

    keep_awake.run("https://gameaccess-api-dev.onrender.com/", 0.01, stop, get)
    assert asked == ["https://gameaccess-api-dev.onrender.com/ping"] * 3


def test_a_failed_ping_is_logged_and_does_not_stop_the_loop():
    def broken(url, timeout):
        raise httpx.ConnectError("down")

    assert keep_awake.ping_once("https://x", broken) is False
    assert keep_awake.ping_once("https://x", lambda url, timeout: Answer(503)) is False
    assert keep_awake.ping_once("https://x", lambda url, timeout: Answer(200)) is True


def test_it_only_starts_on_render_and_can_be_turned_off(monkeypatch):
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert keep_awake.start() is False
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://x.onrender.com")
    monkeypatch.setenv("GAMEACCESS_KEEP_AWAKE", "0")
    assert keep_awake.start() is False


def test_ping_answers_with_nothing():
    from fastapi.testclient import TestClient
    from app.main import app
    response = TestClient(app).get("/ping")
    assert response.status_code == 204 and response.content == b""
