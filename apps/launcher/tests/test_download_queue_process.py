"""The real Download Manager process with a real worker, on an isolated copy of the launcher.

A slow local HTTP server serves a zip. The test pauses (the place is freed, no bytes move), resumes, closes the
Download Manager in the middle of the transfer like closing the app, opens it again and checks the download resumes
from what was on disk and installs.
"""
import http.server
import io
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

import pytest

LAUNCHER = Path(__file__).resolve().parents[1]
TOKEN = "t" * 24


def isolated_launcher(tmp_path: Path) -> Path:
    target = tmp_path / "launcher"
    target.mkdir()
    for item in LAUNCHER.iterdir():
        if item.is_file() and item.suffix in (".py", ".txt"):
            shutil.copy2(item, target / item.name)
        elif item.is_dir() and item.name.startswith(("game_", "sources", "bin")):
            shutil.copytree(item, target / item.name, ignore=shutil.ignore_patterns("__pycache__"))
    return target


def slow_server(data: bytes):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _head(self, code, start, end):
            self.send_response(code)
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Content-Type", "application/zip")
            self.send_header("Accept-Ranges", "bytes")
            if code == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
            self.end_headers()

        def do_GET(self):
            start, end, code = 0, len(data) - 1, 200
            if self.headers.get("Range"):
                first, last = self.headers["Range"].split("=")[1].split("-")
                start, end, code = int(first), int(last) if last else len(data) - 1, 206
            self._head(code, start, end)
            try:
                for offset in range(start, end + 1, 65536):  # about 650 KB/s
                    self.wfile.write(data[offset:min(offset + 65536, end + 1)])
                    time.sleep(0.1)
            except OSError:
                pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class Manager:
    def __init__(self, launcher: Path):
        self.process = subprocess.Popen([sys.executable, "-m", "game_download_manager.queue_service", "--token", TOKEN],
                                        cwd=launcher, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.port = json.loads(self.process.stdout.readline())["port"]

    def call(self, path, body=None):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}",
                                         data=None if body is None else json.dumps(body).encode(),
                                         headers={"X-GameAccess-Token": TOKEN}, method="GET" if body is None else "POST")
        return json.loads(urllib.request.urlopen(request, timeout=10).read())

    def job(self):
        return self.call("/state")["jobs"][0]

    def wait(self, condition, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            job = self.job()
            if condition(job):
                return job
            time.sleep(0.3)
        raise AssertionError(f"timed out: {self.job()}")

    def close(self):
        self.call("/shutdown", {})
        self.process.wait(timeout=20)


@pytest.mark.skipif(os.name != "nt", reason="the workers use the Windows launcher layout")
def test_pause_resume_and_resume_after_closing_with_real_processes(tmp_path):
    launcher = isolated_launcher(tmp_path)
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("Slow/game.exe", os.urandom(10_000_000))
    server = slow_server(payload.getvalue())
    url = f"http://127.0.0.1:{server.server_address[1]}/Slow.zip"
    manager = Manager(launcher)
    try:
        manager.call("/config", {"tier": "plus"})
        manager.call("/jobs", {"appId": 990001, "name": "Slow Test", "source": url})
        manager.wait(lambda j: j["phase"] == "downloading" and (j["status"].get("bytesDownloaded") or 0) > 300_000)
        manager.call("/jobs/990001/pause", {})
        manager.wait(lambda j: j["phase"] == "paused")
        assert manager.call("/state")["running"] == 0  # a paused download takes no place
        time.sleep(1.0)  # each segment finishes the block it was receiving
        paused = manager.job()
        time.sleep(1.5)
        assert manager.job()["status"].get("bytesDownloaded") == paused["status"].get("bytesDownloaded")
        manager.call("/jobs/990001/resume", {})
        manager.wait(lambda j: j["phase"] == "downloading" and (j["status"].get("bytesDownloaded") or 0) > (paused["status"].get("bytesDownloaded") or 0))
        manager.close()  # the app closes in the middle of the transfer

        manager = Manager(launcher)
        assert manager.job()["phase"] == "queued"  # it waits for the plan, then resumes first
        manager.call("/config", {"tier": "plus"})
        done = manager.wait(lambda j: j["state"] == "done", timeout=90)
        assert done["phase"] == "completed", done
        assert (launcher / "games" / "990001-Slow Test-ready").is_dir()
        assert "Retomando la descarga" in (launcher / "logs" / "downloads.log").read_text(encoding="utf-8", errors="replace")
    finally:
        try:
            manager.close()
        except Exception:
            manager.process.kill()
        server.shutdown()
        server.server_close()
