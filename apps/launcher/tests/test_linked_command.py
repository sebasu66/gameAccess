import json
import logging
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_library_manager.linked as linked_module
from game_library_manager.linked import LinkedGames, checked_command, default_command, run_linked

LOG = logging.getLogger("t")


@pytest.fixture
def linked(tmp_path):
    games = LinkedGames(tmp_path)
    steam_folder, own_folder = tmp_path / "Half", tmp_path / "Own"
    steam_folder.mkdir(); own_folder.mkdir()
    (own_folder / "game.exe").write_bytes(b"x")
    games.link(100, "Half", str(steam_folder), "steam")
    games.link(200, "Own", str(own_folder), "folder", str(own_folder / "game.exe"))
    return games, own_folder


def test_a_steam_game_and_a_folder_game_only_differ_in_their_default_command(linked):
    games, own = linked
    assert run_linked("game-options", games.get(100), games, LOG) == {"linked": True, "command": "", "default_command": "steam://rungameid/100"}
    assert default_command(games.get(200)) == f'"{own / "game.exe"}"'


def test_the_command_is_saved_used_to_play_and_cleared_back_to_the_default(linked, monkeypatch):
    games, own = linked
    started = []
    monkeypatch.setattr(linked_module.os, "startfile", lambda target: started.append(target), raising=False)
    saved = run_linked("save-game-options", games.get(100), games, LOG, payload=json.dumps({"command": "steam://run/100//-dx11/"}))
    assert saved["command"] == "steam://run/100//-dx11/"
    run_linked("play", games.get(100), games, LOG)
    run_linked("save-game-options", games.get(100), games, LOG, payload=json.dumps({"command": " "}))
    run_linked("play", games.get(100), games, LOG)
    assert started == ["steam://run/100//-dx11/", "steam://rungameid/100"]
    # A folder game can be started through Steam too: it is the same kind of game, with another command.
    run_linked("save-game-options", games.get(200), games, LOG, payload=json.dumps({"command": "steam://rungameid/200"}))
    run_linked("play", games.get(200), games, LOG)
    assert started[-1] == "steam://rungameid/200"


def test_an_executable_command_runs_with_its_arguments_from_its_folder(linked, monkeypatch):
    games, own = linked
    calls = []

    class Process:
        pid = 7

    monkeypatch.setattr(linked_module.subprocess, "Popen", lambda parts, **kw: calls.append((parts, kw["cwd"])) or Process())
    games.set_command(100, f'"{own / "game.exe"}" -windowed')
    assert run_linked("play", games.get(100), games, LOG)["pid"] == 7
    assert calls == [([str(own / "game.exe"), "-windowed"], str(own))]


def test_only_steam_addresses_and_existing_executables_are_accepted(linked):
    _, own = linked
    assert checked_command("") == ""
    assert checked_command("STEAM://rungameid/5") == "STEAM://rungameid/5"
    for bad in ["notepad", "http://example.com", f'"{own / "missing.exe"}"', "steam://run/1\n&calc"]:
        with pytest.raises(ValueError):
            checked_command(bad)
