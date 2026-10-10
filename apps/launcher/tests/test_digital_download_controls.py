"""Real HTTP subprocess coverage; uses only a local generated binary fixture."""
import hashlib
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid

LAUNCHER = Path(__file__).resolve().parents[1]
PAYLOAD = b"GameAccess-control-fixture-" * 90000

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_HEAD(self):
        self.send_response(500 if self.path == "/fail.bin" else 200)
        self.send_header("Content-Length", str(len(PAYLOAD)))
        self.end_headers()
    def do_GET(self):
        if self.path == "/fail.bin":
            self.send_error(500, "Fixture transfer failed")
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(PAYLOAD)))
        self.end_headers()
        try:
            for start in range(0, len(PAYLOAD), 16384):
                self.wfile.write(PAYLOAD[start:start+16384])
                self.wfile.flush()
                time.sleep(0.025)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

class DigitalControlsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gameaccess-digital-test-")
        self.app_id = str(900000000 + uuid.uuid4().int % 90000000)
        self.status = LAUNCHER / ".cache" / "digital_downloads" / f"{self.app_id}.json"
        self.control = self.status.with_name(f"{self.app_id}.control.json")
        self.process = None
    def tearDown(self):
        if self.process and self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=5)
        for path in (self.status, self.control, self.status.with_suffix(".json.tmp")):
            path.unlink(missing_ok=True)
        self.temp.cleanup()
    def start(self, path="/fixture.bin", install=None):
        args = [sys.executable, str(LAUNCHER / "digital_downloader.py"),
                "--app-id", self.app_id, "--name", "Local test fixture", "--source",
                f"http://127.0.0.1:{self.server.server_port}{path}", "--connections", "1",
                "--destination-dir", self.temp.name]
        if install:
            args.extend(["--install-process", install])
        self.process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        env=dict(os.environ, TORBOX_API_KEY=""))
    def snapshot(self):
        try:
            return json.loads(self.status.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
    def wait_for(self, predicate, timeout=20):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            value = self.snapshot()
            if predicate(value):
                return value
            time.sleep(0.05)
        self.fail(f"Status did not reach expected condition: {self.snapshot()}")
    def command(self, action):
        temp = self.control.with_suffix(".tmp")
        temp.write_text(json.dumps({"action": action, "requestId": str(uuid.uuid4())}), encoding="utf-8")
        os.replace(temp, self.control)
    def test_pause_resume_and_cancel_real_transfer(self):
        self.start()
        self.wait_for(lambda s: s.get("phase") == "downloading" and s.get("bytesDownloaded", 0) > 65536)
        self.command("pause")
        paused = self.wait_for(lambda s: s.get("phase") == "paused")
        time.sleep(0.5)
        settled = self.snapshot()
        time.sleep(0.7)
        self.assertEqual(self.snapshot().get("phase"), "paused")
        self.assertEqual(self.snapshot().get("bytesDownloaded"), settled.get("bytesDownloaded"))
        self.assertEqual(self.snapshot().get("speedBps"), 0)
        self.command("resume")
        self.wait_for(lambda s: s.get("phase") == "downloading" and s.get("bytesDownloaded", 0) > paused.get("bytesDownloaded", 0))
        self.command("cancel")
        self.wait_for(lambda s: s.get("phase") == "cancelled")
        self.process.wait(timeout=5)
        self.assertNotEqual(self.process.returncode, 0)
        self.assertFalse((Path(self.temp.name) / "fixture.bin").exists())
    def test_completion_has_real_bytes(self):
        self.start()
        result = self.wait_for(lambda s: s.get("phase") == "completed")
        self.process.wait(timeout=5)
        self.assertEqual(self.process.returncode, 0)
        data = (Path(self.temp.name) / "fixture.bin").read_bytes()
        self.assertEqual(hashlib.sha256(data).digest(), hashlib.sha256(PAYLOAD).digest())
        self.assertEqual(result["bytesDownloaded"], len(PAYLOAD))
    def test_error_is_not_cancelled(self):
        self.start("/fail.bin")
        self.wait_for(lambda s: s.get("phase") == "error", timeout=35)
        self.process.wait(timeout=5)
        self.assertEqual(self.snapshot()["phase"], "error")
        self.assertEqual(self.process.returncode, 1)

if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--serve":
        http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), Handler).serve_forever()
    else:
        unittest.main()
