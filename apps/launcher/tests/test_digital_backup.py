import json
import sys
import zipfile
from pathlib import Path
from unittest.mock import patch
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from digital_backup import DigitalArchiveBackup
from digital_storage import DigitalGameStorage
from digital_process_runner import DigitalProcessRunner
import digital_downloader as worker

def prepare(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    folder = storage.register(1, "Fixture Game")
    with zipfile.ZipFile(folder / "main.zip", "w") as archive:
        archive.writestr("Game/game.exe", b"main" * 10000)
        archive.writestr("Game/fix.dll", b"old")
    with zipfile.ZipFile(folder / "patch.zip", "w") as archive:
        archive.writestr("fix.dll", b"new")
    original = (folder / "patch.zip").read_bytes()
    with patch.object(worker, "find_portable_7z", return_value=None), patch.object(worker, "emit_progress"):
        worker.extract_archives_in_path(str(folder), str(folder), game_name="Fixture Game")
    return storage, folder, original

def test_keeps_original_smallest_archive_renamed_and_deletes_other_archives(tmp_path):
    storage, folder, original = prepare(tmp_path)
    backup = folder / "Fixture Game_backup.zip"
    assert backup.read_bytes() == original
    assert not (folder / "patch.zip").exists()
    assert not (folder / "main.zip").exists()
    assert (folder / "Game" / "fix.dll").read_bytes() == b"new"
    assert not list(folder.rglob("backup for *.zip"))
    assert DigitalArchiveBackup.info(folder, "Fixture Game")["destination"] == folder / "Game"

def test_every_play_reapplies_backup_before_spawn(tmp_path):
    storage, folder, original = prepare(tmp_path)
    runner = DigitalProcessRunner(storage)
    patch_file = folder / "Game" / "fix.dll"
    for changed in [b"modified once", b"modified twice"]:
        patch_file.write_bytes(changed)
        def launch(*args, **kwargs):
            assert patch_file.read_bytes() == b"new"
            assert args[0] == [str(folder / "Game" / "game.exe")]
            from unittest.mock import Mock
            return Mock(pid=42, returncode=0)
        with patch.object(worker, "find_portable_7z", return_value=None), patch("digital_process_runner.subprocess.Popen", side_effect=launch):
            result = runner.run("play", 1, "Fixture Game")
        assert result["ok"], result
        assert (folder / "Fixture Game_backup.zip").read_bytes() == original

def test_corrupt_backup_blocks_game_launch(tmp_path):
    storage, folder, original = prepare(tmp_path)
    (folder / "Fixture Game_backup.zip").write_bytes(b"corrupt")
    with patch.object(worker, "find_portable_7z", return_value=None), patch("digital_process_runner.subprocess.Popen") as launch:
        result = DigitalProcessRunner(storage).run("play", 1, "Fixture Game")
        assert not result["ok"]
        launch.assert_not_called()

def test_missing_backup_does_not_require_restore(tmp_path):
    storage, folder, original = prepare(tmp_path)
    (folder / "Fixture Game_backup.zip").unlink()
    with patch("digital_process_runner.subprocess.Popen") as launch:
        launch.return_value.pid = 42
        launch.return_value.returncode = 0
        assert DigitalProcessRunner(storage).run("play", 1, "Fixture Game")["ok"]

def test_backup_is_not_reprocessed_on_directory_scan(tmp_path):
    storage, folder, original = prepare(tmp_path)
    with patch.object(worker, "find_portable_7z", return_value=None):
        assert not worker.extract_archives_in_path(str(folder), str(folder))
    assert (folder / "Fixture Game_backup.zip").read_bytes() == original

def test_preserves_multipart_set_when_retaining_original_backup(tmp_path):
    root = tmp_path / "game"
    root.mkdir()
    for name, content in [("original.part1.rar", b"first"), ("original.part2.rar", b"second")]:
        (root / name).write_bytes(content)
    result = DigitalArchiveBackup.retain(root / "original.part1.rar", root, root, "Fixture Game")
    assert result.name == "Fixture Game_backup.part1.rar"
    assert (root / "Fixture Game_backup.part2.rar").read_bytes() == b"second"

def test_encrypted_original_backup_uses_server_passwords_before_restoration(tmp_path):
    import subprocess
    seven_zip = Path(worker.__file__).parent / "bin" / "7z" / "7z.exe"
    if not seven_zip.is_file():
        pytest.skip("7-Zip needed")
    storage = DigitalGameStorage(tmp_path)
    folder = storage.register(1, "Fixture Game")
    payload = folder / "fix.dll"
    payload.write_bytes(b"encrypted incoming")
    archive = folder / "patch.7z"
    subprocess.run([str(seven_zip), "a", str(archive), str(payload), "-pfixture-password", "-mhe=on", "-y"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=15)
    payload.unlink()
    with patch.object(worker, "find_portable_7z", return_value=str(seven_zip)), patch.object(worker, "emit_progress"):
        worker.extract_archives_in_path(str(archive), str(folder), password="fixture-password", game_name="Fixture Game")
    assert DigitalArchiveBackup.info(folder, "Fixture Game")["needs_password"]
    payload.write_bytes(b"changed")
    replies = tmp_path / ".cache" / "digital_downloads"
    replies.mkdir(parents=True)
    reply = replies / "1.passwords.json"
    reply.write_text(json.dumps({"passwords": ["wrong", "fixture-password"]}))
    completed = replies / "1.json"
    completed.write_text(json.dumps({"phase": "completed"}))
    with patch.object(worker, "find_portable_7z", return_value=str(seven_zip)):
        assert DigitalArchiveBackup.restore(folder, "Fixture Game", 1, tmp_path)
    assert payload.read_bytes() == b"encrypted incoming"
    assert not reply.exists()
    assert json.loads(completed.read_text())["phase"] == "completed"

def test_automatic_source_skips_patch_rules_and_preserves_existing_files(tmp_path):
    folder = tmp_path / "game"
    folder.mkdir()
    (folder / "fix.dll").write_bytes(b"existing")
    with zipfile.ZipFile(folder / "main.zip", "w") as archive:
        archive.writestr("Game/game.exe", b"main" * 10000)
    with zipfile.ZipFile(folder / "patch.zip", "w") as archive:
        archive.writestr("fix.dll", b"incoming")
    with patch.object(worker, "find_portable_7z", return_value=None), patch.object(worker, "emit_progress"):
        assert worker.extract_archives_in_path(str(folder), str(folder), game_name="Fixture Game", auto_installed=True)
    assert (folder / "fix.dll").read_bytes() == b"existing"
    assert not (folder / "Game" / "fix.dll").exists()
    assert not list(folder.rglob("*.zip"))
    assert not (folder / ".digital-backup.json").exists()

def test_automatic_source_play_ignores_backup_and_password_metadata(tmp_path):
    storage, folder, original = prepare(tmp_path)
    (folder / "Fixture Game_backup.zip").write_bytes(b"corrupt")
    (folder / ".digital-backup.json").write_text("invalid")
    patch_file = folder / "Game" / "fix.dll"
    patch_file.write_bytes(b"modified")
    runner = DigitalProcessRunner(storage)
    assert not runner.run("status", 1, "Fixture Game", auto_installed=True)["backup_requires_password"]
    with patch("digital_process_runner.subprocess.Popen") as launch, patch.object(DigitalArchiveBackup, "restore") as restore:
        launch.return_value.pid = 42
        launch.return_value.returncode = 0
        assert runner.run("play", 1, "Fixture Game", auto_installed=True)["ok"]
        restore.assert_not_called()
        launch.assert_called_once()
    assert patch_file.read_bytes() == b"modified"
