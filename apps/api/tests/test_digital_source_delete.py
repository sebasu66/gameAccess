from __future__ import annotations

from fastapi.testclient import TestClient

from app import digital_admin_routes as routes
from app.main import app

client = TestClient(app)

# Windows-style path with backslashes: this is what broke the inline JS handler.
WIN_URL = "C:\\DEV\\Game Access Dev\\apps\\api\\data\\sources\\onlinefix_123.json"


def _isolate(monkeypatch, sources, cache, catalog):
    """Keep tests off the real sources/cache/catalog files."""
    state = {"cfg": {"sources": sources}, "cache": cache, "catalog": catalog}

    monkeypatch.setattr(routes, "load_sources_config", lambda: state["cfg"])
    monkeypatch.setattr(routes, "save_sources_config", lambda d: state.__setitem__("cfg", d))
    monkeypatch.setattr(routes, "load_cached_downloads", lambda: list(state["cache"]))
    monkeypatch.setattr(routes, "save_cached_downloads", lambda d: state.__setitem__("cache", list(d)))
    monkeypatch.setattr(routes, "load_digital_catalog_json", lambda *a, **k: list(state["catalog"]))
    monkeypatch.setattr(routes, "save_catalog_json", lambda d: state.__setitem__("catalog", list(d)))
    return state


def test_delete_source_removes_source_and_its_cached_items(monkeypatch):
    state = _isolate(
        monkeypatch,
        sources=[
            {"url": WIN_URL, "label": "OnlineFix", "enabled": True},
            {"url": "https://example.com/other.json", "label": "Other", "enabled": True},
        ],
        cache=[
            {"raw_title": "A", "source_url": WIN_URL, "source": "OnlineFix"},
            {"raw_title": "B", "source_url": "", "source": "OnlineFix"},
            {"raw_title": "C", "source_url": "https://example.com/other.json", "source": "Other"},
        ],
        catalog=[],
    )

    resp = client.request("DELETE", "/admin-console/digital/sources", json={"url": WIN_URL})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["removed_cached_items"] == 2

    assert [s["url"] for s in state["cfg"]["sources"]] == ["https://example.com/other.json"]
    assert [d["raw_title"] for d in state["cache"]] == ["C"]


def test_delete_unknown_source_returns_404(monkeypatch):
    _isolate(monkeypatch, sources=[], cache=[], catalog=[])
    resp = client.request("DELETE", "/admin-console/digital/sources", json={"url": "nope"})
    assert resp.status_code == 404


def test_clear_catalog_empties_everything(monkeypatch):
    state = _isolate(
        monkeypatch,
        sources=[],
        cache=[],
        catalog=[{"id": 282800, "name": "100% Orange Juice"}, {"id": 1623730, "name": "Palworld"}],
    )
    resp = client.post("/admin-console/digital/catalog/clear")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "removed_games": 2}
    assert state["catalog"] == []
