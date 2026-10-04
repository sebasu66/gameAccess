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

    slash_resp = client.get("/admin-console/digital/")
    assert slash_resp.status_code == 200

    alias_slash_resp = client.get("/admin/digital/")
    assert alias_slash_resp.status_code == 200


def test_admin_console_has_link_to_digital_section():
    # Both /admin-console and /admin-console/ should load index.html
    resp = client.get("/admin-console/")
    assert resp.status_code == 200
    assert "/admin-console/digital" in resp.text
    assert "Sección Digital" in resp.text

    resp_noslash = client.get("/admin-console")
    assert resp_noslash.status_code == 200
    assert "/admin-console/digital" in resp_noslash.text

    resp_admin = client.get("/admin")
    assert resp_admin.status_code == 200
    assert "/admin-console/digital" in resp_admin.text


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


def test_import_hydra_source_json():
    hydra_sample = {
        "name": "Comunidad FitGirl Test",
        "downloads": [
            {
                "title": "Hollow Knight: Silksong (v1.0) [FitGirl Repack]",
                "uris": ["magnet:?xt=urn:btih:hollowknightsilksongtest1234567890abcdef12&dn=Hollow+Knight"],
                "fileSize": "4.5 GB",
                "uploadDate": "2024-06-01T00:00:00.000Z"
            }
        ]
    }
    resp = client.post(
        "/admin-console/digital/sources/import-json",
        json={
            "raw_json": json.dumps(hydra_sample),
            "label": "FitGirl Test",
            "auto_add_to_catalog": True,
        }
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["mode"] == "hydra_source"
    assert data["indexed_items"] == 1
    assert data["added_to_catalog"] >= 0

    # Verify game now exists in catalog
    cat_resp = client.get("/admin-console/digital/catalog")
    assert cat_resp.status_code == 200
    cat_games = cat_resp.json()
    assert any("Hollow Knight" in g.get("name", "") for g in cat_games)


def test_get_digital_catalog_variations():
    for path in ["/digital/catalog", "/digital-catalog.json", "/digital_catalog.json"]:
        resp = client.get(path)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


def test_import_direct_hydra_json_payload():
    user_format = {
        "name": "Source name",
        "downloads": [
            {
                "title": "Stardew Valley 1.6",
                "uploadDate": "2026-10-04T17:51:42+00:00",
                "fileSize": "33.6 GB",
                "uris": [
                    "magnet:?xt=urn:btih:stardewtest1234567890abcdef1234567890abcdef&dn=Stardew"
                ]
            }
        ]
    }
    resp = client.post(
        "/admin-console/digital/sources/import-json",
        json=user_format,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["mode"] == "hydra_source"
    assert data["source_name"] == "Source name"
    assert data["indexed_items"] == 1
    assert data["added_to_catalog"] >= 0


def test_digital_source_resolution():
    # Query source endpoint for Stardew Valley
    resp = client.get("/digital/source/999999?name=Stardew+Valley")
    # If found via hydra source or returns 200/404 properly
    assert resp.status_code in [200, 404]
    if resp.status_code == 200:
        data = resp.json()
        assert "uri" in data
        assert data["ok"] is True


