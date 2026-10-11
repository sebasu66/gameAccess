"""Real harmless Windows process launch, using a temporary game folder."""
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from digital_storage import DigitalGameStorage
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
