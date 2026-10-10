import gzip
import json
import sqlite3
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from build_catalog_snapshot import build_snapshot
from app.catalog_snapshot import write_snapshot
from app.discovery_catalog import apply_enrichment, cooptimus_features, discover, merge_search, parse_search


def page(app_id, released, name="A &amp; B"):
    return {"success": 1, "total_count": 250, "results_html": f"""
    <a class="search_result_row" data-ds-appid="{app_id}" data-ds-tagids="[19,1685]" href="https://store.steampowered.com/app/{app_id}/">
      <span class="title">{name}</span><div class="search_released">{released}</div>
      <span data-tooltip-html="Very Positive&lt;br&gt;95% of the 1,234 user reviews for this game are positive."></span>
    </a>"""}


def test_search_identity_review_and_tags():
    row = parse_search(page(10, "Oct 10, 2026"))[0]
    assert row["app_id"] == 10
    assert row["name"] == "A & B"
    assert row["review_count"] == 1234
    assert row["review_score"] == 95
    games = {}
    merge_search(games, [row], {19: "Action", 1685: "Co-op"})
    assert games[10]["coop"] is True
    assert games[10]["tag_sources"]["steam-store"] == ["Action", "Co-op"]
    assert "local_coop" not in games[10]  # Unknown does not become false.
    assert "downloadSource" not in games[10]


def test_traversal_includes_boundary_and_stops_before_older_games():
    class Remote:
        def get(self, url, params):
            return {0: page(10, "Oct 10, 2026"), 100: page(11, "Oct 10, 2025"),
                    200: page(12, "Oct 9, 2025")}[params["start"]]
    rows, report = discover(Remote(), date(2025,10,10), date(2026,10,10), popular_limit=0)
    assert {row["app_id"] for row in rows} == {10,11}
    assert report["recent_complete"] is True
    assert report["recent_count"] == 2


def test_incomplete_page_is_not_published():
    class Remote:
        def get(self, url, params):
            return page(10, "Oct 10, 2026") if params["start"] == 0 else {"success":1,"total_count":250,"results_html":""}
    with pytest.raises(ValueError, match="no game rows"):
        discover(Remote(), date(2025,10,10), date(2026,10,10), popular_limit=0)


def test_cooptimus_requires_exact_steam_identity():
    xml = "<games><game><steam>10</steam><local>4</local><online>8</online></game></games>"
    assert cooptimus_features(xml, 11) is None
    assert cooptimus_features("<html>Blocked</html>", 10) is None
    features = cooptimus_features(xml, 10)
    game = {"tags":["Action"]}
    apply_enrichment(game, {"source":"co-optimus", **features})
    assert game["local_players_max"] == 4
    assert game["online_coop"] is True
    assert "Couch co-op: 4 players" in game["tags"]
    assert game["players_source"] == "co-optimus"


def test_snapshot_is_reproducible_and_preserves_details(tmp_path):
    games = [(7,10,json.dumps({"id":7,"app_id":10,"name":"Fixture","tags":["Puzzle"]}))]
    details = {(7,"english","us"): json.dumps({"steam":{"name":"Fixture"}})}
    artifact, manifest_path = write_snapshot(games, details, tmp_path, "fixture")
    first = artifact.read_bytes()
    write_snapshot(games, details, tmp_path, "fixture")
    assert artifact.read_bytes() == first
    manifest = json.loads(manifest_path.read_text())
    assert manifest["generated_at"]
    db = sqlite3.connect(":memory:"); db.deserialize(gzip.decompress(first))
    assert db.execute("select count(*) from game_detail").fetchone()[0] == 1


def test_database_export_needs_no_provider_accounts(tmp_path):
    # Mirror the real schema while deliberately omitting accountgame altogether.
    from app.main import Game
    from app.catalog_metadata import ensure_catalog_schema, seed_known_games, upsert_steam_metadata
    engine = create_engine(f"sqlite:///{tmp_path / 'source.db'}")
    Game.__table__.create(engine)
    ensure_catalog_schema(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO game (id,app_id,name,slug,active,credit_cost_per_hour) VALUES (7,10,'Fixture','fixture',1,0)"))
    seed_known_games(engine)
    upsert_steam_metadata(engine, 7, {"app_id":10,"type":"game","name":"Fixture","genres":["Action"],"categories":["Single-player"]})
    artifact, manifest = build_snapshot(str(engine.url), tmp_path / "out", "fixture")
    assert json.loads(manifest.read_text())["catalog_count"] == 1
