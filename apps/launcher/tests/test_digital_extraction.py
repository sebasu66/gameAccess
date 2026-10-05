"""Extraction regressions using portable 7-Zip and generated archives."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

LAUNCHER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(LAUNCHER))
SEVEN_ZIP = LAUNCHER / "bin" / "7z" / "7z.exe"

def load_worker():
    spec = importlib.util.spec_from_file_location("digital_worker", LAUNCHER / "digital_downloader.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    return worker

class ExtractionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gameaccess-extract-")
        self.root = Path(self.temp.name)
        self.source = self.root / "fixture.bin"
        self.source.write_bytes(b"generated extraction fixture" * 10000)
    def tearDown(self):
        self.temp.cleanup()
    def archive(self, name="fixture.7z", password=None):
        target = self.root / name
        args = [str(SEVEN_ZIP), "a", str(target), str(self.source), "-y"]
        if password:
            args += ["-p" + password, "-mhe=on"]
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=10)
        return target
    def extract(self, archive, password=""):
        return subprocess.run([sys.executable, __file__, "--extract", str(archive),
            str(self.root / "output"), password], capture_output=True, text=True, timeout=10)
    @unittest.skipUnless(SEVEN_ZIP.exists(), "portable 7-Zip required")
    def test_encrypted_archive_fails_promptly_and_is_preserved(self):
        arc = self.archive(password="fixture-password")
        result = self.extract(arc)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requiere una contraseña válida", result.stdout)
        self.assertNotIn('"phase": "completed"', result.stdout)
        self.assertTrue(arc.exists())
    @unittest.skipUnless(SEVEN_ZIP.exists(), "portable 7-Zip required")
    def test_correct_password_extracts_real_bytes(self):
        arc = self.archive(password="fixture-password")
        result = self.extract(arc, "fixture-password")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.root / "output" / "fixture.bin").read_bytes(), self.source.read_bytes())
    @unittest.skipUnless(SEVEN_ZIP.exists(), "portable 7-Zip required")
    def test_does_not_extract_another_downloads_archive(self):
        arc = self.archive()
        output = self.root / "output"
        output.mkdir()
        unrelated = output / "other.7z"
        unrelated.write_bytes(b"invalid archive belonging to another download")
        result = self.extract(arc)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(unrelated.read_bytes(), b"invalid archive belonging to another download")
    @unittest.skipUnless(SEVEN_ZIP.exists(), "portable 7-Zip required")
    def test_tries_server_passwords_in_order_until_success(self):
        arc = self.archive(password="fixture-password")
        output = self.root / "output"
        output.mkdir()
        (output / "server-reply.json").write_text(json.dumps({"passwords": ["wrong-password", "fixture-password"]}), encoding="utf-8")
        result = self.extract(arc)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Probando contraseña 3/3", result.stdout)
        self.assertNotIn("wrong-password", result.stdout)
        self.assertEqual((output / "fixture.bin").read_bytes(), self.source.read_bytes())
    @unittest.skipUnless(SEVEN_ZIP.exists(), "portable 7-Zip required")
    def test_exhausted_server_passwords_report_error_and_preserve_archive(self):
        arc = self.archive(password="fixture-password")
        output = self.root / "output"
        output.mkdir()
        (output / "server-reply.json").write_text(json.dumps({"passwords": ["wrong-one", "wrong-two"]}), encoding="utf-8")
        result = self.extract(arc)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ninguna contraseña del servidor funcionó", result.stdout)
        self.assertTrue(arc.exists())
    def test_smallest_flat_archive_is_last_and_goes_inside_game_folder(self):
        import zipfile
        worker = load_worker()
        packages = self.root / "packages"
        packages.mkdir()
        small = packages / "a-small-fix.zip"
        large = packages / "z-large-game.zip"
        with zipfile.ZipFile(small, "w") as archive:
            archive.writestr("fix.dll", b"fix")
        with zipfile.ZipFile(large, "w") as archive:
            archive.writestr("Game/game.exe", b"main" * 10000)
            archive.writestr("Game/fix.dll", b"old replaced bytes")
        for extractor in [None, str(SEVEN_ZIP) if SEVEN_ZIP.exists() else None]:
            output = self.root / ("native" if extractor else "fallback")
            events = []
            with patch.object(worker, "find_portable_7z", return_value=extractor), patch.object(worker, "emit_progress", side_effect=lambda **event: events.append(event)):
                worker.extract_archives_in_path(str(packages), str(output), delete_archive=False, retain_backup=False)
            self.assertEqual((output / "Game" / "fix.dll").read_bytes(), b"fix")
            self.assertFalse((output / "fix.dll").exists())
            organizing = [e["status_text"] for e in events if e.get("status_text", "").startswith("Organizando")]
            self.assertIn("z-large-game.zip", organizing[0])
            self.assertIn("a-small-fix.zip", organizing[1])

    def test_auxiliary_archive_does_not_replace_the_game_subfolder(self):
        import zipfile
        worker = load_worker()
        packages = self.root / "packages"
        packages.mkdir()
        for filename, member, data in [
            ("main.zip", "Game/game.exe", b"main" * 10000),
            ("tools.zip", "Tools/tool.dat", b"tool" * 1000),
            ("fix.zip", "fix.dll", b"fix")]:
            with zipfile.ZipFile(packages / filename, "w") as archive:
                archive.writestr(member, data)
        output = self.root / "output"
        with patch.object(worker, "find_portable_7z", return_value=None), patch.object(worker, "emit_progress"):
            worker.extract_archives_in_path(str(packages), str(output), delete_archive=False, retain_backup=False)
        self.assertTrue((output / "Game" / "fix.dll").is_file())
        self.assertFalse((output / "Tools" / "fix.dll").exists())

    def test_smallest_archive_with_own_folder_does_not_double_nest(self):
        import zipfile
        worker = load_worker()
        packages = self.root / "packages"
        packages.mkdir()
        with zipfile.ZipFile(packages / "main.zip", "w") as archive:
            archive.writestr("Game/game.exe", b"main" * 10000)
        with zipfile.ZipFile(packages / "fix.zip", "w") as archive:
            archive.writestr("Game/fix.dll", b"fix")
        output = self.root / "output"
        with patch.object(worker, "find_portable_7z", return_value=None), patch.object(worker, "emit_progress"):
            worker.extract_archives_in_path(str(packages), str(output), delete_archive=False, retain_backup=False)
        self.assertTrue((output / "Game" / "fix.dll").is_file())
        self.assertFalse((output / "Game" / "Game").exists())

    @unittest.skipUnless(SEVEN_ZIP.exists(), "portable 7-Zip required")
    def test_smallest_7z_flat_fix_is_extracted_into_game_subfolder(self):
        import zipfile
        worker = load_worker()
        packages = self.root / "packages"
        packages.mkdir()
        with zipfile.ZipFile(packages / "main.zip", "w") as archive:
            archive.writestr("Game/game.exe", b"main" * 10000)
        fix = self.root / "fix.dll"
        fix.write_bytes(b"fix")
        subprocess.run([str(SEVEN_ZIP), "a", str(packages / "fix.7z"), str(fix), "-y"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=10)
        output = self.root / "output"
        with patch.object(worker, "find_portable_7z", return_value=str(SEVEN_ZIP)), patch.object(worker, "emit_progress"):
            worker.extract_archives_in_path(str(packages), str(output), delete_archive=False, retain_backup=False)
        self.assertEqual((output / "Game" / "fix.dll").read_bytes(), b"fix")
        self.assertFalse((output / "fix.dll").exists())

    def test_reports_percentages_from_extractor_output(self):
        worker = load_worker()
        arc = self.root / "fixture.7z"
        arc.write_bytes(b"fake archive for output parser")
        child = unittest.mock.Mock()
        child.stdout = io.StringIO("extracting\r 25%\r 65%\r 100%\n")
        child.wait.return_value = 0
        events = []
        with patch.object(worker, "archive_member_names", return_value=["fixture.bin"]), patch.object(worker, "archive_enclosing_folder", return_value=None), patch.object(worker, "find_portable_7z", return_value="7z"), patch.object(worker.subprocess, "Popen", return_value=child), patch.object(worker, "emit_progress", side_effect=lambda **event: events.append(event)):
            self.assertTrue(worker.extract_archives_in_path(str(arc), str(self.root), delete_archive=False))
        self.assertIn(25, [event["progress_percent"] for event in events])
        self.assertIn(65, [event["progress_percent"] for event in events])

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--extract":
        worker = load_worker()
        worker.LAUNCHER_DIR = Path(sys.argv[3])
        worker.g_app_id = "fixture"
        reply = worker.LAUNCHER_DIR / ".cache" / "digital_downloads" / "fixture.passwords.json"
        reply.parent.mkdir(parents=True, exist_ok=True)
        server_reply = worker.LAUNCHER_DIR / "server-reply.json"
        reply.write_text(server_reply.read_text(encoding="utf-8") if server_reply.exists() else '{"passwords": []}', encoding="utf-8")
        worker.find_portable_7z = lambda: str(SEVEN_ZIP)
        try:
            worker.extract_archives_in_path(sys.argv[2], sys.argv[3], password=sys.argv[4] or None, delete_archive=False, retain_backup=False)
        except Exception as error:
            worker.emit_error("fixture", str(error))
            sys.exit(1)
    else:
        unittest.main()
