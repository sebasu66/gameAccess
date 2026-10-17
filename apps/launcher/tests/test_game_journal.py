import sys
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_journal as journal
from digital_storage import DigitalGameStorage
from digital_process_runner import DigitalProcessRunner

def test_note_appends_lines_and_never_raises(tmp_path):
    journal.note(tmp_path, "estado", "downloading")
    journal.note(tmp_path, "play", "lanzado\ncon salto")
    journal.note(tmp_path / "missing", "x", "y")
    lines = journal.read(tmp_path).splitlines()
    assert len(lines) == 2 and lines[0].endswith("| estado | downloading") and "\n" not in lines[1]

def test_journal_is_trimmed_and_is_not_game_content(tmp_path):
    for _ in range(3000):
        journal.note(tmp_path, "paso", "x" * 120)
    assert (tmp_path / journal.JOURNAL_FILE).stat().st_size <= journal.MAX_BYTES + 500
    storage = DigitalGameStorage(tmp_path / "launcher")
    folder = storage.register(1, "Game")
    journal.note(folder, "estado", "ready")
    assert list(storage.has_content(folder)) == []

def test_play_is_journaled_and_readable_through_the_runner(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    folder = storage.set_status(1, "Game", "ready") if storage.register(1, "Game") else None
    (folder / "game.exe").write_bytes(b"exe")
    with patch("digital_process_runner.subprocess.Popen", return_value=Mock(pid=7, returncode=0)):
        assert DigitalProcessRunner(storage).run("play", 1, "Game")["ok"]
    log = DigitalProcessRunner(storage).run("game-log", 1, "Game")["log"]
    assert "play | solicitado" in log and "lanzado: game.exe (pid 7)" in log
