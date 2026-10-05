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
    def test_reports_percentages_from_extractor_output(self):
        worker = load_worker()
        arc = self.root / "fixture.7z"
        arc.write_bytes(b"fake archive for output parser")
        child = unittest.mock.Mock()
        child.stdout = io.StringIO("extracting\r 25%\r 65%\r 100%\n")
        child.wait.return_value = 0
        events = []
        with patch.object(worker, "find_portable_7z", return_value="7z"), patch.object(worker.subprocess, "Popen", return_value=child), patch.object(worker, "emit_progress", side_effect=lambda **event: events.append(event)):
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
            worker.extract_archives_in_path(sys.argv[2], sys.argv[3], password=sys.argv[4] or None, delete_archive=False)
        except Exception as error:
            worker.emit_error("fixture", str(error))
            sys.exit(1)
    else:
        unittest.main()
