import sqlite3
from pathlib import Path

from app.discovery_catalog import merge_server_games


def make_db(path: Path):
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE game(id INTEGER PRIMARY KEY, app_id INTEGER, name TEXT, slug TEXT, active INTEGER);
        CREATE TABLE game_metadata(game_id INTEGER, product_type TEXT, short_description TEXT, developers_json TEXT,
            publishers_json TEXT, recommendation_count INTEGER, metacritic_score INTEGER, release_date TEXT,
            steam_review_score REAL, steam_review_count INTEGER, single_player INTEGER, multiplayer INTEGER,
            coop INTEGER, online_coop INTEGER, local_coop INTEGER, shared_split_screen INTEGER, mmo INTEGER, pvp INTEGER);
        CREATE TABLE game_genre(game_id INTEGER, name TEXT);
        CREATE TABLE game_category(game_id INTEGER, name TEXT);
        CREATE TABLE game_tag(game_id INTEGER, name TEXT);
    """)
    rows = [(1, 553850, "HELLDIVERS 2", "helldivers-2", "game"), (2, 1, "Some Demo", "demo", "demo"),
            (3, 99, "Steam 99", "steam-99", "game"), (4, 730, "Counter-Strike 2", "cs2", "game")]
    for gid, app, name, slug, kind in rows:
        db.execute("INSERT INTO game VALUES (?,?,?,?,1)", (gid, app, name, slug))
        db.execute("INSERT INTO game_metadata(game_id, product_type, recommendation_count, multiplayer) VALUES (?,?,?,1)",
                   (gid, kind, 840848 if gid == 1 else 5))
    db.execute("INSERT INTO game_genre VALUES (1, 'Action')")
    db.commit()
    db.close()


def test_server_games_missing_from_the_catalog_are_added(tmp_path):
    make_db(tmp_path / "server.db")
    games = {730: {"id": 7, "app_id": 730, "name": "Counter-Strike 2"}}
    assert merge_server_games(games, tmp_path / "server.db") == 1
    assert set(games) == {730, 553850}
    added = games[553850]
    assert added["name"] == "HELLDIVERS 2" and added["recommendation_count"] == 840848
    assert added["genres"] == ["Action"] and added["multiplayer"] is True and added["id"] == 8
    assert games[730] == {"id": 7, "app_id": 730, "name": "Counter-Strike 2"}


def test_missing_server_database_adds_nothing(tmp_path):
    assert merge_server_games({}, tmp_path / "nope.db") == 0
