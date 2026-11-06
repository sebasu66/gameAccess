import httpx
import pytest
from fastapi.testclient import TestClient

from app import steam_owned_routes as routes
from app.main import app

PUBLIC, PRIVATE, BROKEN = "76561198000000001", "76561198000000002", "76561198000000003"


@pytest.fixture
def steam(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        steam_id = request.url.params["steamid"]
        calls.append(steam_id)
        assert request.url.params["key"] == "K" * 32
        if steam_id == PUBLIC:
            return httpx.Response(200, json={"response": {"game_count": 2, "games": [{"appid": 10, "name": "Alpha"}, {"appid": 20}]}})
        if steam_id == PRIVATE:
            return httpx.Response(200, json={"response": {}})
        return httpx.Response(500)

    real_client = httpx.Client
    monkeypatch.setattr(routes.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    monkeypatch.setenv("STEAM_WEB_API_KEY", "K" * 32)
    monkeypatch.setattr(routes, "_cache", {})
    monkeypatch.setattr(routes, "_requests", {})
    return calls


def test_owned_games_per_account_with_private_profiles_apart(steam):
    with TestClient(app) as client:
        body = client.post("/steam/owned-games", json={"steam_ids": [PUBLIC, PRIVATE, BROKEN, PUBLIC]}).json()
    assert body["accounts"] == {PUBLIC: [{"app_id": 10, "name": "Alpha"}, {"app_id": 20, "name": ""}], PRIVATE: []}
    assert body["private"] == [PRIVATE]
    assert body["errors"] == {BROKEN: "HTTPStatusError"}
    assert "K" * 32 not in str(body)
    assert steam == [PUBLIC, PRIVATE, BROKEN]


def test_answers_are_cached_per_account(steam):
    with TestClient(app) as client:
        client.post("/steam/owned-games", json={"steam_ids": [PUBLIC]})
        client.post("/steam/owned-games", json={"steam_ids": [PUBLIC]})
    assert steam == [PUBLIC]


def test_rejects_bad_ids_missing_key_and_too_many_requests(steam, monkeypatch):
    with TestClient(app) as client:
        assert client.post("/steam/owned-games", json={"steam_ids": ["123"]}).status_code == 422
        assert client.post("/steam/owned-games", json={"steam_ids": []}).status_code == 422
        monkeypatch.setattr(routes, "REQUESTS_PER_HOUR", 1)
        assert client.post("/steam/owned-games", json={"steam_ids": [PUBLIC]}).status_code == 200
        assert client.post("/steam/owned-games", json={"steam_ids": [PUBLIC]}).status_code == 429
        monkeypatch.delenv("STEAM_WEB_API_KEY")
        assert client.post("/steam/owned-games", json={"steam_ids": [PUBLIC]}).json()["detail"] == "steam_key_missing"
