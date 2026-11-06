#!/usr/bin/env python
from __future__ import annotations

import argparse
import csv
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = REPO_ROOT / "apps" / "api" / "gameaccess.db"
DEFAULT_CSV = REPO_ROOT / "apps" / "api" / ".admin_tasks" / "steamspy_tag_data.csv"
SOURCE = "steamspy-historical-2019"

ACRONYMS = {
    "2d": "2D", "3d": "3D", "4x": "4X", "6dof": "6DOF",
    "atv": "ATV", "bmx": "BMX", "crpg": "CRPG", "fmv": "FMV",
    "fps": "FPS", "jrpg": "JRPG", "mmo": "MMO", "mmorpg": "MMORPG",
    "moba": "MOBA", "nsfw": "NSFW", "pve": "PvE", "pvp": "PvP",
    "rpg": "RPG", "rts": "RTS", "vr": "VR",
}
OVERRIDES = {
    "co_op": "Co-op",
    "co_op_campaign": "Co-op Campaign",
    "online_co_op": "Online Co-op",
    "local_co_op": "Local Co-op",
    "local_multiplayer": "Local Multiplayer",
    "asynchronous_multiplayer": "Asynchronous Multiplayer",
    "massively_multiplayer": "Massively Multiplayer",
    "pixel_graphics": "Pixel Graphics",
    "souls_like": "Souls-like",
    "rogue_like": "Rogue-like",
    "rogue_lite": "Rogue-lite",
    "turn_based": "Turn-Based",
    "turn_based_combat": "Turn-Based Combat",
    "turn_based_strategy": "Turn-Based Strategy",
    "turn_based_tactics": "Turn-Based Tactics",
    "story_rich": "Story Rich",
    "open_world": "Open World",
    "family_friendly": "Family Friendly",
    "early_access": "Early Access",
    "free_to_play": "Free to Play",
    "singleplayer": "Singleplayer",
    "multiplayer": "Multiplayer",
    "e_sports": "eSports",
}

def label_for(column: str) -> str:
    if column in OVERRIDES:
        return OVERRIDES[column]
    if column in ACRONYMS:
        return ACRONYMS[column]
    parts = column.split("_")
    return " ".join(ACRONYMS.get(part, part.capitalize()) for part in parts)

def licensed_targets(con: sqlite3.Connection) -> dict[int, int]:
    rows = con.execute(
        """
        SELECT DISTINCT g.app_id, g.id
        FROM game g
        JOIN game_metadata m ON m.game_id=g.id
        WHERE g.active=1
          AND g.app_id IS NOT NULL
          AND lower(coalesce(m.product_type,''))='game'
          AND EXISTS (SELECT 1 FROM accountgame ag WHERE ag.game_id=g.id)
        """
    ).fetchall()
    return {int(app_id): int(game_id) for app_id, game_id in rows}

def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap GameAccess community tags from a SteamSpy tag matrix.")
    parser.add_argument("--database", type=Path, default=DEFAULT_DB)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--max-tags", type=int, default=20)
    args = parser.parse_args()

    con = sqlite3.connect(args.database)
    targets = licensed_targets(con)
    matched_games = 0
    tag_rows = 0

    with args.csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        tag_columns = [name for name in (reader.fieldnames or []) if name != "appid"]
        for row in reader:
            try:
                app_id = int(row.get("appid") or 0)
            except (TypeError, ValueError):
                continue
            game_id = targets.get(app_id)
            if not game_id:
                continue

            weighted: list[tuple[str, int]] = []
            for column in tag_columns:
                try:
                    weight = int(row.get(column) or 0)
                except (TypeError, ValueError):
                    weight = 0
                if weight > 0:
                    weighted.append((label_for(column), weight))
            if not weighted:
                continue
            weighted.sort(key=lambda item: (-item[1], item[0].casefold()))
            weighted = weighted[: max(1, args.max_tags)]

            con.execute("DELETE FROM game_tag WHERE game_id=? AND source=?", (game_id, SOURCE))
            con.executemany(
                """
                INSERT INTO game_tag(game_id,name,source,weight)
                VALUES (?,?,?,?)
                ON CONFLICT(game_id,name,source) DO UPDATE SET weight=excluded.weight
                """,
                [(game_id, name, SOURCE, weight) for name, weight in weighted],
            )
            matched_games += 1
            tag_rows += len(weighted)

    con.commit()
    total_games, total_tags = con.execute(
        "SELECT count(distinct game_id), count(*) FROM game_tag"
    ).fetchone()
    print(
        f"historical matched_games={matched_games} imported_tags={tag_rows} "
        f"total_games_with_tags={total_games} total_tag_rows={total_tags}"
    )
    con.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
