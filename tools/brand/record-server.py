"""Serve the committed logo recorder on loopback and save its PNG archive."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--port", type=int, default=38483)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

class Recorder(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/save-animation-frames":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length < 512 * 1024 * 1024:
            self.send_error(413)
            return
        target = args.output / "gameaccess-animation-frames.tar"
        remaining = length
        with target.open("wb") as archive:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    self.send_error(400)
                    return
                archive.write(chunk)
                remaining -= len(chunk)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"saved")
        print(f"Saved {length} bytes to {target}", flush=True)

handler = partial(Recorder, directory=str(Path(__file__).parent))
print(f"http://127.0.0.1:{args.port}/animation-studio.html", flush=True)
ThreadingHTTPServer(("127.0.0.1", args.port), handler).serve_forever()
