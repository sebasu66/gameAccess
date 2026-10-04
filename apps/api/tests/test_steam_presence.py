from app.steam_presence import SteamPresence, _parse_player_summaries


def test_player_summary_marks_gameid_as_online_playing():
    result = _parse_player_summaries(
        {
            "response": {
                "players": [
                    {"steamid": "76561198000000001", "gameid": "730"},
                    {"steamid": "76561198000000002"},
                ]
            }
        },
        ["76561198000000001", "76561198000000002"],
    )

    assert result["76561198000000001"] == SteamPresence(
        steam_id64="76561198000000001",
        known=True,
        playing=True,
        game_id=730,
    )
    assert result["76561198000000002"].known is True
    assert result["76561198000000002"].playing is False


def test_missing_player_is_unknown_not_idle():
    result = _parse_player_summaries(
        {"response": {"players": []}},
        ["76561198000000001"],
    )
    assert result["76561198000000001"].known is False
    assert result["76561198000000001"].playing is False
