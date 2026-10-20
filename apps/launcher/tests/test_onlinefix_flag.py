import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from game_execution_manager.onlinefix_flag import OnlineFixFlag, read_flag, write_flag

ORIGINAL = "[Main]\nRealAppId=413150\nLanguage=english\n\n[Hashes]\n0=base-a\n"
GENERIC = "defa34"     # the provider profile's value, the same for every game
SEEN = "e7c07f"        # what OnlineFix writes after its dialog, for this game


def prepare(folder: Path, original=ORIGINAL):
    """What Play does before the game starts: the fix archive recreates the file, the profile sets its value."""
    ini = folder / "Game" / "OnlineFix.ini"
    ini.parent.mkdir(parents=True, exist_ok=True)
    ini.write_text(original, encoding="utf-8")
    write_flag(ini, GENERIC)
    return ini


def play(folder, flag, original=ORIGINAL):
    flag.learn(folder)
    ini = prepare(folder, original)
    flag.restore(folder)
    return ini


def test_the_value_onlinefix_writes_after_its_dialog_is_put_back_on_every_play(tmp_path):
    flag = OnlineFixFlag(tmp_path / "state.json")
    game = tmp_path / "game"
    ini = play(game, flag)
    assert read_flag(ini) == GENERIC          # first Play: nothing learned yet, the dialog shows once
    write_flag(ini, SEEN)                     # OnlineFix, after its dialog
    ini = play(game, flag)
    assert read_flag(ini) == SEEN
    assert read_flag(ini, "0") == "base-a" and "Language=english" in ini.read_text(encoding="utf-8")
    ini = play(game, flag)                    # OnlineFix left it alone: it stays
    assert read_flag(ini) == SEEN


def test_a_game_played_before_keeps_the_value_it_already_has(tmp_path):
    flag = OnlineFixFlag(tmp_path / "state.json")
    game = tmp_path / "game"
    ini = prepare(game)
    write_flag(ini, SEEN)                     # played before GameAccess learned anything
    ini = play(game, flag)
    assert read_flag(ini) == SEEN


def test_a_wrong_guess_is_corrected_after_one_run(tmp_path):
    flag = OnlineFixFlag(tmp_path / "state.json")
    game = tmp_path / "game"
    ini = prepare(game)                       # a never-played game holds the profile's value
    ini = play(game, flag)                    # taken as a guess: the dialog shows this time
    write_flag(ini, SEEN)
    assert read_flag(play(game, flag)) == SEEN


def test_another_fix_version_learns_its_own_value(tmp_path):
    flag = OnlineFixFlag(tmp_path / "state.json")
    game = tmp_path / "game"
    ini = play(game, flag)
    write_flag(ini, SEEN)
    play(game, flag)
    ini = play(game, flag, ORIGINAL.replace("base-a", "base-b"))  # a new fix: another 0=
    assert read_flag(ini) == GENERIC
    write_flag(ini, "new-seen")
    ini = play(game, flag, ORIGINAL.replace("base-a", "base-b"))
    assert read_flag(ini) == "new-seen"


def test_each_onlinefix_file_keeps_its_own_value(tmp_path):
    flag = OnlineFixFlag(tmp_path / "state.json")
    game = tmp_path / "game"
    other = game / "Other" / "OnlineFix.ini"
    other.parent.mkdir(parents=True)
    other.write_text(ORIGINAL, encoding="utf-8")
    ini = play(game, flag)
    write_flag(ini, SEEN)
    write_flag(other, "other-seen")
    flag.learn(game)
    prepare(game)
    flag.restore(game)
    assert read_flag(ini) == SEEN and read_flag(other) == "other-seen"


def test_a_file_without_the_section_gets_it(tmp_path):
    ini = tmp_path / "OnlineFix.ini"
    ini.write_text("[Main]\nRealAppId=1\n", encoding="utf-8")
    write_flag(ini, "abc")
    assert read_flag(ini) == "abc" and ini.read_text(encoding="utf-8").startswith("[Main]\nRealAppId=1\n")


def test_a_game_without_onlinefix_leaves_no_state(tmp_path):
    flag = OnlineFixFlag(tmp_path / "state.json")
    (tmp_path / "game").mkdir()
    flag.learn(tmp_path / "game")
    flag.restore(tmp_path / "game")
    assert not (tmp_path / "state.json").exists()
