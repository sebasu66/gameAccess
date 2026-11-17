"""Real harmless Windows process launch, using a temporary game folder."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_library_manager.storage import DigitalGameStorage
from digital_process_runner import DigitalProcessRunner


@pytest.mark.skipif(sys.platform != "win32", reason="Windows launcher smoke")
def test_play_reaches_real_process_and_uninstall_removes_only_its_folder(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    folder = storage.register(42, "Launch fixture")
    (folder / "game.exe").write_bytes(b"payload marker; never executed")
    (folder / "play.bat").write_text("@echo off\necho fixture>started.txt\nexit /b 0\n")
    sibling = storage.register(43, "Other fixture")
    (sibling / "keep.txt").write_text("preserve")
    runner = DigitalProcessRunner(storage)
    played = runner.run("play", 42, "Launch fixture", auto_installed=True)
    assert played["ok"], played
    assert played["pid"] > 0
    assert (folder / "started.txt").read_text().strip() == "fixture"
    assert runner.run("uninstall", 42, "Launch fixture")["ok"]
    assert not folder.exists()
    assert (sibling / "keep.txt").read_text() == "preserve"


def _game(storage, app_id, name):
    folder = storage.register(app_id, name)
    (folder / "game.exe").write_bytes(b"payload marker; never executed")
    (folder / "play.bat").write_text("@echo off\nexit /b 0\n")
    return folder


def _trace(storage, app_id):
    import json
    from game_execution_manager.launch_trace import progress_path
    return json.loads(progress_path(storage.launcher, app_id).read_text(encoding="utf-8"))


@pytest.mark.skipif(sys.platform != "win32", reason="Windows launcher smoke")
def test_play_leaves_a_live_trace_the_dialog_can_read(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    _game(storage, 50, "Trace fixture")
    played = DigitalProcessRunner(storage).run("play", 50, "Trace fixture", auto_installed=True)
    assert played["ok"], played
    trace = _trace(storage, 50)
    assert trace["finished"] is True and trace["ok"] is True
    assert trace["lines"][0]["text"] == "Play requested"
    assert any("launch accepted" in line["text"] for line in trace["lines"])


@pytest.mark.skipif(sys.platform != "win32", reason="Windows launcher smoke")
def test_a_failed_play_says_why_in_the_trace(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    storage.register(51, "Empty fixture")
    played = DigitalProcessRunner(storage).run("play", 51, "Empty fixture", auto_installed=True)
    assert not played["ok"] and played["error"]
    trace = _trace(storage, 51)
    assert trace["finished"] is True and trace["ok"] is False and trace["error"] == played["error"]


@pytest.mark.skipif(sys.platform != "win32", reason="Windows launcher smoke")
def test_the_app_language_is_not_forced_into_a_game_that_does_not_ship_it(tmp_path, monkeypatch):
    """Naruto did not open: its fix said English and the app forced Spanish, which the game does not have."""
    monkeypatch.setenv("GAMEACCESS_APP_LANGUAGE", "spanish")
    storage = DigitalGameStorage(tmp_path)
    folder = _game(storage, 52, "English only")
    ini = folder / "steam_emu.ini"
    ini.write_text("Language=english\n", encoding="utf-8")
    (folder / "data").mkdir()
    (folder / "data" / "text_en.pak").write_bytes(b"x")
    assert DigitalProcessRunner(storage).run("play", 52, "English only", auto_installed=True)["ok"]
    assert ini.read_text(encoding="utf-8") == "Language=english\n"
    # The same game with Spanish files does get the app's language.
    (folder / "data" / "text_es.pak").write_bytes(b"x")
    assert DigitalProcessRunner(storage).run("play", 52, "English only", auto_installed=True)["ok"]
    assert "spanish" in ini.read_text(encoding="utf-8").lower()
    # "Without changing the language" puts the original back and later plays leave it alone.
    assert DigitalProcessRunner(storage).run("restore-language", 52, "English only")["ok"]
    assert ini.read_text(encoding="utf-8") == "Language=english\n"
    assert DigitalProcessRunner(storage).run("play", 52, "English only", auto_installed=True)["ok"]
    assert ini.read_text(encoding="utf-8") == "Language=english\n"
