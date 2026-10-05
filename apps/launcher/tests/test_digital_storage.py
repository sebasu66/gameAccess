import http.server
import functools
import threading
import subprocess
import shutil
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from digital_storage import DigitalGameStorage
from digital_process_runner import DigitalProcessRunner
from digital_downloader import extract_archives_in_path
import digital_downloader
import zipfile

class DigitalStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="digital-storage-fixture-")
        self.storage = DigitalGameStorage(Path(self.temp.name))
        self.runner = DigitalProcessRunner(self.storage)
    def tearDown(self):
        self.temp.cleanup()
    def test_extract_play_delete_use_same_folder(self):
        folder = self.storage.register(1, "Fixture")
        archive = folder / "fixture.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("bin/game.exe", b"fixture executable")
        with patch.object(digital_downloader, "find_portable_7z", return_value=None), patch.object(digital_downloader, "emit_progress"):
            extract_archives_in_path(str(archive), str(folder), delete_archive=False)
        self.assertTrue(archive.is_file())
        self.assertTrue(self.storage.status(1, "Fixture")["installed"])
        with patch("digital_process_runner.subprocess.Popen") as spawn:
            spawn.return_value.pid = 42
            result = self.runner.run("play", 1, "Fixture")
            self.assertTrue(result["ok"], result)
            self.assertEqual(spawn.call_args.args[0], [str(folder / "bin" / "game.exe")])
            self.assertEqual(spawn.call_args.kwargs["cwd"], str(folder / "bin"))
        sibling = self.storage.register(2, "Other")
        (sibling / "other.exe").write_bytes(b"fixture")
        result = self.runner.run("uninstall", 1, "Fixture", "steam://uninstall/1")
        self.assertTrue(result["ok"], result)
        self.assertFalse(folder.exists())
        self.assertTrue(sibling.exists())
        self.assertFalse(self.storage.status(1, "Fixture")["installed"])
    def test_http_worker_downloads_and_extracts_in_place_without_install_command(self):
        launcher = Path(self.temp.name)
        original = Path(__file__).resolve().parents[1]
        for file in ["digital_downloader.py", "digital_storage.py"]:
            shutil.copyfile(original / file, launcher / file)
        source = launcher / "source"
        source.mkdir()
        with zipfile.ZipFile(source / "fixture.zip", "w") as archive:
            archive.writestr("game.exe", b"fixture executable")
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(source)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            result = subprocess.run([sys.executable, str(launcher / "digital_downloader.py"),
                "--app-id", "1", "--name", "Fixture", "--source",
                f"http://127.0.0.1:{server.server_port}/fixture.zip",
                "--keep-archive", "--install-process", "cmd /c exit 99"],
                cwd=launcher, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout[-1000:])
            folder = self.storage.folder(1, "Fixture")
            self.assertTrue((folder / "fixture.zip").is_file())
            self.assertTrue((folder / "game.exe").is_file())
            status = json.loads((launcher / ".cache" / "digital_downloads" / "1.json").read_text())
            self.assertEqual(status["phase"], "completed")
        finally:
            server.shutdown()
            server.server_close()

    def test_empty_and_archive_only_folders_are_not_playable(self):
        folder = self.storage.register(1, "Fixture")
        self.assertFalse(self.storage.status(1, "Fixture")["installed"])
        (folder / "fixture.rar").write_bytes(b"encrypted")
        self.assertFalse(self.storage.status(1, "Fixture")["installed"])
    def test_existing_legacy_folder_is_used_without_moving(self):
        legacy = self.storage.root / "Minecraft Dungeons II"
        legacy.mkdir(parents=True)
        (legacy / "game.exe").write_bytes(b"fixture")
        self.assertEqual(self.storage.register(1, "Minecraft Dungeons II"), legacy)
        self.assertEqual(self.storage.folder(1, "Renamed"), legacy)
    def test_uninstall_refuses_root_or_external_registry_paths(self):
        self.storage.registry.mkdir(parents=True)
        for folder in [self.storage.root, Path(self.temp.name)]:
            (self.storage.registry / "1.json").write_text(json.dumps({"folder": str(folder)}))
            result = self.runner.run("uninstall", 1, "Fixture")
            self.assertFalse(result["ok"])
            self.assertTrue(Path(self.temp.name).exists())
    def test_no_steam_or_external_launch(self):
        folder = self.storage.register(1, "Fixture")
        (folder / "game.exe").write_bytes(b"fixture")
        for command in ["steam://run/1", "../external.exe", "game.exe && steam.exe"]:
            self.assertFalse(self.runner.run("play", 1, "Fixture", command)["ok"])
    def test_missing_folder_does_not_fall_back_to_launcher_cwd(self):
        with patch("digital_process_runner.subprocess.Popen") as spawn:
            self.assertFalse(self.runner.run("play", 1, "Missing", "game.exe")["ok"])
            spawn.assert_not_called()

if __name__ == "__main__":
    unittest.main()
