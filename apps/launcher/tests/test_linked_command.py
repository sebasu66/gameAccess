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
    # A folder's game has the launch options of any game instead (Seba, 2026-11-02): no command, a command typed
    # before is dropped when they are saved.
    games.set_command(200, "steam://rungameid/200")
    shown = run_linked("save-game-options", games.get(200), games, LOG, payload=json.dumps({"executable": "", "arguments": "-windowed"}))
    assert shown["kind"] == "folder" and "command" not in shown and games.get(200)["command"] == ""
    assert shown["options"]["arguments"] == "-windowed"


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
    for bad in ["notepad", "http://example.com", f'"{own / "missing.exe"}"', "steam://run/1\n&calc", "wait 999"]:
        with pytest.raises(ValueError):
            checked_command(bad)


def test_steps_sign_steam_out_and_in_then_run_the_game_in_order_without_logging_the_password(linked, monkeypatch):
    games, own = linked
    steam = own / "steam.exe"
    steam.write_bytes(b"x")
    command = f'"{steam}" -shutdown\n\n# then the other account\n"{steam}" -login kid "s3cret pass"\nwait 5\nsteam://rungameid/100'
    assert checked_command(command).count("\n") == 3
    events = []

    class Process:
        def __init__(self, parts):
            self.pid = len(events)
            events.append(("run", parts[1:]))

        def wait(self, timeout):
            events.append(("waited", timeout))

    monkeypatch.setattr(linked_module.subprocess, "Popen", lambda parts, **kw: Process(parts))
    monkeypatch.setattr(linked_module.os, "startfile", lambda target: events.append(("open", target)), raising=False)
    still_open = iter([True, False])
    outcome = linked_module.run_sequence(checked_command(command), sleep=lambda s: events.append(("sleep", s)), probe=lambda _: next(still_open))
    assert events == [("run", ["-shutdown"]), ("waited", 10), ("sleep", 1), ("run", ["-login", "kid", "s3cret pass"]), ("waited", 10),
                      ("sleep", 5), ("open", "steam://rungameid/100")]
    assert "s3cret" not in outcome["command"] and "-login kid ****" in outcome["command"]
    games.set_command(100, command)
    history = linked_module.journal.read(games.log_dir(100))
    assert "-login kid ****" in history and "s3cret" not in history
