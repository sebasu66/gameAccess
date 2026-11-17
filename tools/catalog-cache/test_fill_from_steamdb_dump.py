"""The fill step must not publish a catalog thinner than the published one.

This guards the failure that actually happened: the server rebuilds its snapshot
from the discovery seed, whose category coverage is under 1%, so a rebuild
replaced a filled catalog with an empty one and the filters went quiet again.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fill_from_steamdb_dump import (  # noqa: E402
    PLAYER_CATEGORIES,
    category_coverage,
    player_categories,
    regression_guard,
)


def write_manifest(directory: Path, categories: int) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "catalog-manifest.json").write_text(
        json.dumps({"coverage": {"steamdb": {"categories": categories}}}),
        encoding="utf-8",
    )


def games_with(categories: int) -> dict[int, dict]:
    return {app_id: ({"categories": ["Single-player"]} if app_id <= categories else {})
            for app_id in range(1, 11)}


def test_counts_only_records_that_carry_categories():
    assert category_coverage(games_with(4)) == 4
    assert category_coverage({}) == 0


def test_no_manifest_means_nothing_to_compare(tmp_path: Path):
    regression_guard(games_with(1), tmp_path, allow=False)


def test_a_manifest_without_the_fill_marker_is_ignored(tmp_path: Path):
    (tmp_path / "catalog-manifest.json").write_text(json.dumps({"coverage": {}}), encoding="utf-8")
    regression_guard(games_with(1), tmp_path, allow=False)


def test_publishes_when_coverage_grows_or_holds(tmp_path: Path):
    write_manifest(tmp_path, 4)
    regression_guard(games_with(6), tmp_path, allow=False)
    regression_guard(games_with(4), tmp_path, allow=False)


def test_refuses_to_publish_a_thinner_catalog(tmp_path: Path):
    write_manifest(tmp_path, 40000)
    with pytest.raises(SystemExit) as error:
        regression_guard(games_with(3), tmp_path, allow=False)
    # The message has to name the cause, because the symptom (empty filters)
    # looks nothing like the reason (a rebuild from a thin seed).
    assert "drop from 40000 to 3" in str(error.value)
    assert "server rebuilt" in str(error.value)


def test_the_guard_can_be_overridden_explicitly(tmp_path: Path):
    write_manifest(tmp_path, 40000)
    regression_guard(games_with(3), tmp_path, allow=True)


def test_player_categories_keeps_only_player_support_entries():
    values = ["Single-player", "Multi-player", "PvP", "Steam Achievements",
              "Steam Cloud", "Co-op", "Shared/Split Screen", "Cross-Platform Multiplayer"]
    assert player_categories(values) == [
        "Single-player", "Multi-player", "PvP", "Co-op", "Shared/Split Screen",
        "Cross-Platform Multiplayer",
    ]
    assert "Steam Achievements" not in PLAYER_CATEGORIES
    assert player_categories(None) == []
    assert player_categories([1, None, "Co-op"]) == ["Co-op"]
