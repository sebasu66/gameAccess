"""Artwork, age-rating and player-category resolution: ids, never derived guesses."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from app.catalog_artwork import (
    CACHE_VERSION,
    ArtworkResolver,
    apply_assets,
    asset_url,
    assets_from_item,
    categories_from_item,
    descriptors_from_item,
    has_nudity_descriptor,
    is_adult_only,
)

ITEM = {
    "appid": 3664670,
    "assets": {
        "asset_url_format": "steam/apps/3664670/${FILENAME}?t=1790020982",
        "library_capsule_2x": "581ef82520eb2be8d4829c349eb4666c7e2ab88a/library_capsule_2x.jpg",
        "library_hero_2x": "bec4a4395a60b3c2d27f5ddfd5ee85eded4c2fb6/library_hero_2x.jpg",
    },
    "content_descriptorids": [1, 3, 4, 5],
    # Shape returned by the store API: ids grouped by what they describe.
    "categories": {
        "supported_player_categoryids": [2, 1, 9, 38, 48, 39, 24],
        "feature_categoryids": [22, 29, 23],
        "controller_categoryids": [28],
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
    resolved = {1: {"capsule_image": "real-capsule", "hero_image": "real-hero", "header_image": None,
                    "content_descriptorids": [2, 5], "steam_category_ids": [1, 2]}}
    report = apply_assets(games, resolved)

    assert games[1]["capsule_image"] == "real-capsule"
    assert games[1]["hero_image"] == "real-hero"
    # A field the API did not return must not be erased.
    assert games[1]["header_image"] == "guessed-header"
    # A game the API did not cover keeps whatever it had.
    assert games[2]["capsule_image"] == "guessed"
    assert report == {"matched": 1, "capsule": 1, "hero": 1, "header": 0, "missing": 1,
                      "descriptors": 1, "adult_only": 0, "nudity": 0, "categories": 1}


def test_apply_assets_leaves_a_cache_without_descriptors_untouched():
    # A batch cached before descriptors were collected carries no key; the record
    # must not be overwritten with an empty rating.
    games = {1: {"capsule_image": "old", "adult_only": True}}
    report = apply_assets(games, {1: {"capsule_image": "real"}})
    assert games[1]["capsule_image"] == "real"
    assert games[1]["adult_only"] is True
    assert "content_descriptorids" not in games[1]
    assert report["descriptors"] == 0


def test_apply_assets_records_official_descriptors_and_adult_only():
    games = {
        976310: {},   # Mortal Kombat 11: violence and mature only
        943700: {},   # adult-only
        488790: {},   # South Park: some nudity plus violence and mature
    }
    resolved = {
        976310: {"content_descriptorids": [2, 5]},
        943700: {"content_descriptorids": [1, 3, 4, 5]},
        488790: {"content_descriptorids": [1, 2, 5]},
    }
    report = apply_assets(games, resolved)

    # Valve's own rating for Mortal Kombat 11 carries no sexual descriptor, which
    # is exactly why a community tag must not decide the adult block.
    assert games[976310]["content_descriptorids"] == [2, 5]
    assert games[976310]["adult_only"] is False
    assert games[943700]["adult_only"] is True
    assert games[488790]["adult_only"] is False
    assert has_nudity_descriptor(games[488790]["content_descriptorids"]) is True
    assert report["descriptors"] == 3
    assert report["adult_only"] == 1
    assert report["nudity"] == 2


class TestDescriptorRules:
    def test_adult_only_needs_descriptor_3_or_4(self):
        assert is_adult_only([1, 3, 4, 5]) is True
        assert is_adult_only([3]) is True
        assert is_adult_only([2, 5]) is False
        assert is_adult_only([1, 2, 5]) is False
        assert is_adult_only([]) is False
        assert is_adult_only(None) is False

    def test_nudity_is_descriptor_1_and_is_separate(self):
        assert has_nudity_descriptor([1, 2, 5]) is True
        assert has_nudity_descriptor([2, 5]) is False
        assert has_nudity_descriptor(None) is False

    def test_descriptors_are_normalised_and_ignore_junk(self):
        assert descriptors_from_item({"content_descriptorids": [5, 1, 5]}) == [1, 5]
        assert descriptors_from_item({"content_descriptorids": [0, -1, "x", None, 2]}) == [2]
        assert descriptors_from_item({}) == []
        assert descriptors_from_item({"content_descriptorids": "1,2"}) == []


class TestCategoryIds:
    """Ids, not text: the catalog's category text is localized ("JcJ" for PvP),
    so any text matcher silently fails outside English."""

    def test_keeps_only_player_support_ids(self):
        assert categories_from_item(ITEM) == [1, 2, 9, 24, 38, 39, 48]
        # Feature and controller ids do not feed the player filters.
        assert 22 not in categories_from_item(ITEM)
        assert 28 not in categories_from_item(ITEM)

    def test_ignores_unknown_and_malformed_values(self):
        assert categories_from_item({"categories": {"supported_player_categoryids": [2, 999, "x", None]}}) == [2]
        assert categories_from_item({"categories": {}}) == []
        assert categories_from_item({"categories": "2,1"}) == []
        assert categories_from_item({}) == []

    def test_apply_assets_records_categories(self):
        games = {1: {}}
        report = apply_assets(games, {1: {"steam_category_ids": [1, 2]}})
        assert games[1]["steam_category_ids"] == [1, 2]
        assert report["categories"] == 1

    def test_a_cache_without_categories_does_not_erase_them(self):
        games = {1: {"steam_category_ids": [2]}}
        apply_assets(games, {1: {"capsule_image": "real"}})
        assert games[1]["steam_category_ids"] == [2]

    def test_cache_key_changes_with_the_payload_version(self, tmp_path: Path):
        # A batch cached before a field existed must not be reused, or the new
        # field would read as "the API returned nothing".
        resolver = ArtworkResolver(FakeClient([ITEM]), tmp_path / "artwork", delay=0)
        (tmp_path / "artwork").mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(json.dumps([CACHE_VERSION, [3664670]]).encode()).hexdigest()
        assert resolver._cache_path([3664670]).name == key + ".json"


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
