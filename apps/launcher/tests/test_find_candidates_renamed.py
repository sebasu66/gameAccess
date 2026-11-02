import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_execution_manager.executables import find_candidates


def test_a_folder_renamed_inside_the_game_is_found_again_after_the_stale_play_bat(tmp_path):
    # It was found in "Naruto Shippuden Ultimate Ninja Storm 4 Road to Boruto" and the player renamed that folder by hand.
    game = tmp_path / "1020790-Naruto-ready"
    (game / "Naruto").mkdir(parents=True)
    (game / "Naruto" / "NARUTO.exe").write_bytes(b"x")
    (game / ".gameaccess_exe").write_text("Naruto Shippuden Ultimate Ninja Storm 4 Road to Boruto/NARUTO.exe", encoding="utf-8")
    (game / "play.bat").write_text('@echo off\ncd /d "%~dp0Naruto Shippuden Ultimate Ninja Storm 4 Road to Boruto"\n"NARUTO.exe"\n', encoding="utf-8")
    tried = [exe.name for exe, _ in find_candidates(game, "Naruto")]
    assert tried == ["play.bat", "NARUTO.exe"]


def test_the_remembered_executable_still_goes_first(tmp_path):
    game = tmp_path / "g"
    (game / "bin").mkdir(parents=True)
    for name in ("bin/Game.exe", "Other.exe"):
        (game / name).write_bytes(b"x")
    (game / ".gameaccess_exe").write_text("bin/Game.exe", encoding="utf-8")
    tried = [exe for exe, _ in find_candidates(game, "Game")]
    assert tried[0] == (game / "bin" / "Game.exe").resolve() and len(tried) == len(set(tried)) == 2
