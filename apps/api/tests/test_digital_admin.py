from __future__ import annotations

import json
from pathlib import Path
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


def test_resolve_steam_app_id_nascar_26():
    from app.digital_admin_routes import resolve_steam_app_id
    # Test NASCAR 26 resolving to base game 4883590 and not DLC/Pass
    match = resolve_steam_app_id("NASCAR 26")
    assert match is not None
    app_id, name = match
    assert app_id == 4883590
    assert "NASCAR 26" in name


def test_extract_version_tuple():
    from app.digital_admin_routes import extract_version_tuple
    assert extract_version_tuple("Cyberpunk 2077 v2.12 [FitGirl Repack]") == (2, 12)
    assert extract_version_tuple("Cyberpunk 2077 v2.13.1") == (2, 13, 1)
    assert extract_version_tuple("Elden Ring Build 123456") == (123456,)
    assert extract_version_tuple("Baldur's Gate 3 4.1.1.4251417") == (4, 1, 1, 4251417)
    assert extract_version_tuple("Game Without Version") == ()


def test_deduplicate_keeps_highest_version_from_same_source():
    from app.digital_admin_routes import deduplicate_download_items
    items = [
        {
            "raw_title": "Grand Theft Auto V v1.0.2802 [FitGirl]",
            "clean_title": "Grand Theft Auto V",
            "uri": "magnet:?xt=urn:btih:old_v2802",
            "source": "FitGirl",
            "upload_date": "2023-01-01",
        },
        {
            "raw_title": "Grand Theft Auto V v1.0.3095 [FitGirl]",
            "clean_title": "Grand Theft Auto V",
            "uri": "magnet:?xt=urn:btih:new_v3095",
            "source": "FitGirl",
            "upload_date": "2023-06-01",
        },
    ]
    cfg = {"sources": [{"label": "FitGirl", "url": "https://fitgirl.com", "priority": 1}]}
    deduped = deduplicate_download_items(items, cfg)
    assert len(deduped) == 1
    assert deduped[0]["uri"] == "magnet:?xt=urn:btih:new_v3095"


def test_deduplicate_respects_source_priority():
    from app.digital_admin_routes import deduplicate_download_items
    # FitGirl (priority 1) has v1.0, DODI (priority 2) has newer v2.0
    items = [
        {
            "raw_title": "Cyberpunk 2077 v1.0 [FitGirl]",
            "clean_title": "Cyberpunk 2077",
            "uri": "magnet:?xt=urn:btih:fitgirl_priority1",
            "source": "FitGirl",
            "upload_date": "2023-01-01",
        },
        {
            "raw_title": "Cyberpunk 2077 v2.0 [DODI]",
            "clean_title": "Cyberpunk 2077",
            "uri": "magnet:?xt=urn:btih:dodi_priority2",
            "source": "DODI",
            "upload_date": "2023-06-01",
        },
    ]
    # FitGirl has priority 1, DODI has priority 2 -> FitGirl must be chosen!
    cfg = {
        "sources": [
            {"label": "FitGirl", "url": "https://fitgirl.com", "priority": 1},
            {"label": "DODI", "url": "https://dodi.com", "priority": 2},
        ]
    }
    deduped = deduplicate_download_items(items, cfg)
    assert len(deduped) == 1
    assert deduped[0]["uri"] == "magnet:?xt=urn:btih:fitgirl_priority1"

    # Now reverse priority: DODI priority 1, FitGirl priority 2 -> DODI must be chosen!
    cfg_reversed = {
        "sources": [
            {"label": "DODI", "url": "https://dodi.com", "priority": 1},
            {"label": "FitGirl", "url": "https://fitgirl.com", "priority": 2},
        ]
    }
    deduped_rev = deduplicate_download_items(items, cfg_reversed)
    assert len(deduped_rev) == 1
    assert deduped_rev[0]["uri"] == "magnet:?xt=urn:btih:dodi_priority2"


def test_update_source_priority_endpoint():
    # Set up two test sources
    client.post("/admin-console/digital/sources", json={"url": "https://source1.com", "label": "S1", "priority": 2})
    client.post("/admin-console/digital/sources", json={"url": "https://source2.com", "label": "S2", "priority": 1})

    # Update priorities via /sources/priority
    resp = client.post(
        "/admin-console/digital/sources/priority",
        json=[
            {"url": "https://source1.com", "priority": 1},
            {"url": "https://source2.com", "priority": 2},
        ],
    )
    assert resp.status_code == 200
    sources = resp.json()["sources"]
    s1 = next(s for s in sources if s["url"] == "https://source1.com")
    s2 = next(s for s in sources if s["url"] == "https://source2.com")
    assert s1["priority"] == 1
    assert s2["priority"] == 2

    # Cleanup
    client.request("DELETE", "/admin-console/digital/sources", json={"url": "https://source1.com"})
    client.request("DELETE", "/admin-console/digital/sources", json={"url": "https://source2.com"})


def test_dotted_versions_without_v_cleaning_and_deduplication():
    from app.digital_admin_routes import (
        clean_user_friendly_title,
        deduplicate_download_items,
        extract_version_tuple,
        normalize_title,
    )
    # 1. Version extraction
    assert extract_version_tuple("33 Immortals 1.0.0.13772") == (1, 0, 0, 13772)
    assert extract_version_tuple("33 Immortals 0.72.0.10499") == (0, 72, 0, 10499)
    assert extract_version_tuple("33 Immortals 0.62.2.8809") == (0, 62, 2, 8809)

    # 2. Title cleaning & normalization
    assert clean_user_friendly_title("33 Immortals 1.0.0.13772") == "33 Immortals"
    assert clean_user_friendly_title("33 Immortals 0.72.0.10499") == "33 Immortals"
    assert normalize_title("33 Immortals 0.72.0.10499") == "33 immortals"
    assert normalize_title("33 Immortals 1.0.0.13772") == "33 immortals"

    # 3. Deduplication of 5 releases from the user screenshot
    releases = [
        {"raw_title": "33 Immortals", "clean_title": "33 Immortals", "uri": "magnet:?xt=urn:btih:base", "source": "Hydra", "upload_date": "2024-01-01"},
        {"raw_title": "33 Immortals 0.62.0.8418", "clean_title": "33 Immortals 0.62.0.8418", "uri": "magnet:?xt=urn:btih:v0620", "source": "Hydra", "upload_date": "2024-02-01"},
        {"raw_title": "33 Immortals 0.62.1.8630", "clean_title": "33 Immortals 0.62.1.8630", "uri": "magnet:?xt=urn:btih:v0621", "source": "Hydra", "upload_date": "2024-03-01"},
        {"raw_title": "33 Immortals 0.62.2.8809", "clean_title": "33 Immortals 0.62.2.8809", "uri": "magnet:?xt=urn:btih:v0622", "source": "Hydra", "upload_date": "2024-04-01"},
        {"raw_title": "33 Immortals 0.72.0.10499", "clean_title": "33 Immortals 0.72.0.10499", "uri": "magnet:?xt=urn:btih:v0720", "source": "Hydra", "upload_date": "2024-05-01"},
        {"raw_title": "33 Immortals 1.0.0.13772", "clean_title": "33 Immortals 1.0.0.13772", "uri": "magnet:?xt=urn:btih:v100", "source": "Hydra", "upload_date": "2024-06-01"},
    ]
    cfg = {"sources": [{"label": "Hydra", "url": "https://hydra.test", "priority": 1}]}
    deduped = deduplicate_download_items(releases, cfg)
    assert len(deduped) == 1
    assert deduped[0]["clean_title"] == "33 Immortals"
    assert deduped[0]["uri"] == "magnet:?xt=urn:btih:v100"


def test_steam_resolver_progressive_fallback_and_no_fake_ids():
    from app.steam_resolver import clean_for_steam_lookup, generate_fallback_queries, resolve_steam_app_id

    # 1. Cleaning rule: 100% Orange Juice with repack, DLC and version tags
    raw = "100% Orange Juice (v1.34.1 + All DLCs) [FitGirl Repack]"
    cleaned = clean_for_steam_lookup(raw)
    assert cleaned == "100% Orange Juice"

    # 2. Fallback query generation
    fallbacks = generate_fallback_queries(cleaned)
    assert fallbacks[0] == "100% Orange Juice"

    # 3. Live Steam lookup: 100% Orange Juice MUST resolve to genuine AppID 282800
    res = resolve_steam_app_id(raw)
    assert res is not None
    app_id, name = res
    assert app_id == 282800
    assert "Orange Juice" in name

    # 4. Standalone 33 Immortals
    res_33 = resolve_steam_app_id("33 Immortals 1.0.0.13772")
    assert res_33 is not None
    assert res_33[0] == 958520

    # 5. Non-existent fake titles must NEVER generate synthetic/fake IDs
    fake_res = resolve_steam_app_id("Nonexistent Fake Game 99999999999")
    assert fake_res is None


def test_cli_standalone_steam_lookup_tool(tmp_path):
    import subprocess
    import sys

    # Create temporary JSON with 100% Orange Juice and a fake game
    sample_file = tmp_path / "test_games.json"
    sample_data = [
        "100% Orange Juice (v1.34.1 + All DLCs) [FitGirl Repack]",
        "Nonexistent Fake Game 99999999999"
    ]
    sample_file.write_text(json.dumps(sample_data, ensure_ascii=False), encoding="utf-8")

    # Run scripts/test_steam_lookup.py
    script_path = Path(__file__).resolve().parent.parent / "scripts" / "test_steam_lookup.py"
    proc = subprocess.run(
        [sys.executable, str(script_path), str(sample_file)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
    )
    assert proc.returncode == 0
    assert "[MATCH]" in proc.stdout
    assert "282800" in proc.stdout
    assert "100% Orange Juice" in proc.stdout
    assert "[NO MATCH]" in proc.stdout
    assert "RESUMEN DE RESOLUCIÓN" in proc.stdout
