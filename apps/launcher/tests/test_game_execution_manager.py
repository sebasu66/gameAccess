import logging
import sys
import zipfile
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_journal as journal
from game_library_manager.storage import DigitalGameStorage
from digital_process_runner import DigitalProcessRunner
from game_execution_manager.execution_profile import save_profile
from game_execution_manager import GameExecutionManager, GameExecutionError
from game_execution_manager.archives import pending_archives

LOG = logging.getLogger("gem-test")

def make(tmp_path, files):
    storage = DigitalGameStorage(tmp_path)
    folder = storage.register(1, "My Game")
    for name, data in files.items():
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(data)
    return storage, folder

def test_analyze_reports_each_state(tmp_path):
    storage, folder = make(tmp_path, {})
    manager = GameExecutionManager(storage)
    assert manager.analyze(1, "My Game")["state"] == "empty"
    (folder / "a.zip").write_bytes(b"zip")
    assert manager.analyze(1, "My Game")["state"] == "extract"
    (folder / "a.zip").unlink()
    (folder / "setup_my_game.exe").write_bytes(b"s")
    assert manager.analyze(1, "My Game")["state"] == "setup"
    (folder / "setup_my_game.exe").unlink()
    (folder / "readme.txt").write_text("hi")
    blocked = manager.analyze(1, "My Game")
    assert blocked["state"] == "blocked" and "ejecutable" in blocked["warning"]
    (folder / "bin").mkdir()
    (folder / "bin" / "MyGame.exe").write_bytes(b"g")
    ready = manager.analyze(1, "My Game")
    assert ready["ready"] and ready["executable"].endswith("MyGame.exe")

def test_prepare_extracts_then_installs_then_finds_the_executable(tmp_path):
    storage, folder = make(tmp_path, {"setup_x.exe": b"s", "setup_x-1.bin": b"b"})
    with zipfile.ZipFile(folder / "extra.zip", "w") as archive:
        archive.writestr("docs/readme.txt", "hello")
    unpacked = []
    def extractor(target, archive):
        unpacked.append(archive.name)
        with zipfile.ZipFile(archive) as z:
            z.extractall(target)
        archive.unlink()
    def installer(command, as_admin):
        Path(next(a for a in command if a.startswith("/DIR="))[5:], "MyGame.exe").write_bytes(b"game")
        return 0
    result = GameExecutionManager(storage, extractor=extractor, installer=installer, logger=LOG).prepare(1, "My Game")
    assert result["ready"] and unpacked == ["extra.zip"]
    log = journal.read(folder)
    assert "descompresión | extra.zip" in log and "instalador" in log and "estado=ready" in log

def test_prepare_fails_with_the_file_and_reason(tmp_path):
    storage, folder = make(tmp_path, {"broken.zip": b"x"})
    def extractor(target, archive):
        raise RuntimeError("CRC")
    with pytest.raises(GameExecutionError, match="descomprimir broken.zip: CRC") as caught:
        GameExecutionManager(storage, extractor=extractor).prepare(1, "My Game")
    assert caught.value.file == "broken.zip"

def test_prepare_without_anything_runnable_explains_it(tmp_path):
    storage, folder = make(tmp_path, {"readme.txt": b"hi"})
    with pytest.raises(GameExecutionError, match="ningún ejecutable"):
        GameExecutionManager(storage).prepare(1, "My Game")

def test_retained_fix_backup_is_not_pending(tmp_path):
    storage, folder = make(tmp_path, {"My Game_backup.zip": b"z", "game.exe": b"g"})
    assert pending_archives(folder) == []

def test_repair_action_marks_ready_or_error_and_writes_the_log(tmp_path):
    storage, folder = make(tmp_path, {"readme.txt": b"hi"})
    runner = DigitalProcessRunner(storage)
    failed = runner.run("game-repair", 1, "My Game")
    assert not failed["ok"] and storage.status(1, "My Game")["state"] == "ERROR"
    folder = storage.folder(1, "My Game")
    (folder / "MyGame.exe").write_bytes(b"g")
    fixed = runner.run("game-repair", 1, "My Game")
    assert fixed["ok"] and storage.status(1, "My Game")["state"] == "ready"
    folder = storage.folder(1, "My Game")
    assert "| ERROR |" in journal.read(folder) and "reparación | listo" in journal.read(folder)
    assert runner.run("game-analyze", 1, "My Game")["analysis"]["ready"]
