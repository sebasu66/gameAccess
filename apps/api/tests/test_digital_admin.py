from __future__ import annotations

import json
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_digital_admin_page_accessible():
    response = client.get("/admin-console/digital")
    assert response.status_code == 200
    assert "Gestión de Catálogo y Fuentes" in response.text

    alias_resp = client.get("/admin/digital")
    assert alias_resp.status_code == 200
    assert "Gestión de Catálogo y Fuentes" in alias_resp.text


def test_get_catalog():
    response = client.get("/admin-console/digital/catalog")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert any("id" in g for g in data)


def test_get_sources():
    response = client.get("/admin-console/digital/sources")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert "sources" in data
    assert isinstance(data["sources"], list)


def test_add_and_delete_source():
    # Add source
    post_resp = client.post(
        "/admin-console/digital/sources",
        json={"url": "https://example.com/test_sources.json", "label": "Test Source", "enabled": True},
    )
    assert post_resp.status_code == 200
    assert post_resp.json()["ok"] is True

    # Verify it exists
    get_resp = client.get("/admin-console/digital/sources")
    sources = get_resp.json()["sources"]
    assert any(s["url"] == "https://example.com/test_sources.json" for s in sources)

    # Delete source
    del_resp = client.request(
        "DELETE",
        "/admin-console/digital/sources",
        json={"url": "https://example.com/test_sources.json"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["ok"] is True


def test_raw_json_validation():
    # Invalid json structure
    bad_resp = client.post(
        "/admin-console/digital/raw-json?target=catalog",
        json={"not": "a list"},
    )
    assert bad_resp.status_code in (400, 422)

    # Valid query options
    opt_resp = client.get("/admin-console/digital/resolve-options?name=Elden+Ring")
    assert opt_resp.status_code == 200
    assert opt_resp.json()["ok"] is True
