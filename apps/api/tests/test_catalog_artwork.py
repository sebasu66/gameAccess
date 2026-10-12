"""Artwork resolution: real hashed URLs only, never a derived guess."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.catalog_artwork import ArtworkResolver, apply_assets, asset_url, assets_from_item

ITEM = {
    "appid": 3664670,
    "assets": {
        "asset_url_format": "steam/apps/3664670/${FILENAME}?t=1790020982",
        "library_capsule_2x": "581ef82520eb2be8d4829c349eb4666c7e2ab88a/library_capsule_2x.jpg",
        "library_hero_2x": "bec4a4395a60b3c2d27f5ddfd5ee85eded4c2fb6/library_hero_2x.jpg",
    },
}


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeClient:
    """Serves the store API shape and counts calls."""

    def __init__(self, items):
        self.items = items
        self.calls = 0

    def get(self, url, params=None):
        self.calls += 1
        wanted = json.loads(params["input_json"])["ids"]
        wanted_ids = {entry["appid"] for entry in wanted}
        return FakeResponse({"response": {"store_items": [i for i in self.items if i["appid"] in wanted_ids]}})


def test_asset_url_uses_the_hashed_path_and_rejects_traversal():
    resolved = asset_url(ITEM["assets"]["asset_url_format"], ITEM["assets"]["library_capsule_2x"])
    # The hash is what makes the URL exist; a derived filename would 404.
    assert resolved == (
        "https://shared.akamai.steamstatic.com/store_item_assets/"
        "steam/apps/3664670/581ef82520eb2be8d4829c349eb4666c7e2ab88a/library_capsule_2x.jpg?t=1790020982"
    )
    assert asset_url("steam/apps/1/${FILENAME}", "../../etc/passwd") is None
    assert asset_url("other/format/${FILENAME}", "a.jpg") is None
    assert asset_url("", "a.jpg") is None


def test_assets_from_item_prefers_2x_and_falls_back_to_1x():
    assets = assets_from_item(ITEM)
    assert "library_capsule_2x.jpg" in assets["capsule_image"]
    assert "library_hero_2x.jpg" in assets["hero_image"]
    # header is absent from this item: unknown stays None, never guessed.
    assert assets["header_image"] is None

    one_x = {"appid": 5, "assets": {
        "asset_url_format": "steam/apps/5/${FILENAME}",
        "library_capsule": "abc/portrait.png",
    }}
    assert assets_from_item(one_x)["capsule_image"].endswith("abc/portrait.png")


def test_apply_assets_replaces_guesses_and_keeps_unknowns_untouched():
    games = {
        1: {"capsule_image": "https://cdn.akamai.steamstatic.com/steam/apps/1/library_600x900_2x.jpg",
            "hero_image": "guessed-hero", "header_image": "guessed-header"},
        2: {"capsule_image": "guessed"},
    }
    resolved = {1: {"capsule_image": "real-capsule", "hero_image": "real-hero", "header_image": None}}
    report = apply_assets(games, resolved)

    assert games[1]["capsule_image"] == "real-capsule"
    assert games[1]["hero_image"] == "real-hero"
    # A field the API did not return must not be erased.
    assert games[1]["header_image"] == "guessed-header"
    # A game the API did not cover keeps whatever it had.
    assert games[2]["capsule_image"] == "guessed"
    assert report == {"matched": 1, "capsule": 1, "hero": 1, "header": 0, "missing": 1}


def test_resolver_caches_batches_so_repeats_cost_nothing(tmp_path: Path):
    client = FakeClient([ITEM])
    resolver = ArtworkResolver(client, tmp_path / "artwork", delay=0)

    first = resolver.resolve([3664670])
    assert first[3664670]["capsule_image"].endswith("library_capsule_2x.jpg?t=1790020982")
    assert client.calls == 1

    second = ArtworkResolver(client, tmp_path / "artwork", delay=0).resolve([3664670])
    assert second == first
    # The cached run must not touch the network again.
    assert client.calls == 1


def test_resolver_batches_large_catalogs(tmp_path: Path):
    items = [{"appid": a, "assets": {"asset_url_format": f"steam/apps/{a}/${{FILENAME}}", "library_capsule_2x": f"h{a}/c.jpg"}} for a in range(1, 121)]
    client = FakeClient(items)
    resolver = ArtworkResolver(client, tmp_path / "artwork", delay=0)
    resolved = resolver.resolve(list(range(1, 121)))
    assert len(resolved) == 120
    # 120 games at 50 per request.
    assert client.calls == 3


def test_resolver_reports_missing_games_instead_of_inventing_them(tmp_path: Path):
    # The API returned nothing for this AppID: it must stay absent, and the
    # failure must not be cached as an empty result.
    client = FakeClient([])
    resolver = ArtworkResolver(client, tmp_path / "artwork", delay=0)
    assert resolver.resolve([42]) == {}
    assert list((tmp_path / "artwork").glob("*.json")) == []
