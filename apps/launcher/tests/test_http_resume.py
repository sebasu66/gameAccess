import json
import logging
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from game_download_manager.http_transport import HttpDownloadTransport, parts_file

DATA = bytes(range(256)) * 4096  # 1 MiB


def serve(requests_seen):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            start, end = 0, len(DATA) - 1
            if self.headers.get("Range"):
                first, last = self.headers["Range"].split("=")[1].split("-")
                start, end = int(first), int(last) if last else len(DATA) - 1
            requests_seen.append((start, end))
            body = DATA[start:end + 1]
            self.send_response(206 if self.headers.get("Range") else 200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Accept-Ranges", "bytes")
            if self.headers.get("Range"):
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(DATA)}")
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def context():
    return SimpleNamespace(logger=logging.getLogger("test-http"), emit_progress=lambda *a, **k: None,
                           wait_if_paused=lambda: None, cancelled=threading.Event(), temp_files=[])


def test_a_stopped_segmented_download_resumes_and_is_not_taken_as_complete(tmp_path):
    seen = []
    server = serve(seen)
    url = f"http://127.0.0.1:{server.server_address[1]}/game.bin"
    target = tmp_path / "game.bin"
    try:
        # What a stopped run leaves: the file preallocated at full size, the first half of each segment written.
        half = len(DATA) // 2
        target.write_bytes(DATA[:half // 2] + b"\0" * (half - half // 2) + DATA[half:half + half // 2] + b"\0" * (len(DATA) - half - half // 2))
        Path(parts_file(str(target))).write_text(json.dumps({"total": len(DATA), "segments": [[0, half - 1, half // 2], [half, len(DATA) - 1, half // 2]]}))
        assert HttpDownloadTransport(context()).download_segmented(url, str(target), "1", "Game", connections=2)
        assert target.read_bytes() == DATA
        assert not Path(parts_file(str(target))).exists()
        ranges = [r for r in seen if r != (0, 511)]
        assert sorted(ranges) == [(half // 2, half - 1), (half + half // 2, len(DATA) - 1)]  # only what was missing
        # Complete and without a progress record: the next run does not download it again.
        seen.clear()
        assert HttpDownloadTransport(context()).download_segmented(url, str(target), "1", "Game", connections=2)
        assert seen == [(0, 511)]
    finally:
        server.shutdown()
        server.server_close()
