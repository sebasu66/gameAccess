from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.premium_routes import CONTENT_FILE, router


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_content_is_public_and_has_a_default_region():
    response = client().get("/premium/content")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert body["region"] == "default"
    assert "default" in body["regions"]
    assert response.headers["cache-control"] == "no-store"


def test_country_header_selects_argentina():
    response = client().get("/premium/content", headers={"CF-IPCountry": "AR"})
    assert response.json()["region"] == "AR"


def test_client_hint_is_used_without_a_header():
    assert client().get("/premium/content?hint=AR").json()["region"] == "AR"


def test_unknown_country_and_bad_hint_fall_back_to_default():
    assert client().get("/premium/content", headers={"CF-IPCountry": "ZZ"}).json()["region"] == "default"
    assert client().get("/premium/content?hint=../etc").json()["region"] == "default"


def test_every_link_is_https():
    import json
    data = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
    for region in data["regions"].values():
        for method in region["methods"]:
            assert method["url"].startswith("https://")
