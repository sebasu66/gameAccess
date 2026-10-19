"""The Download Manager process: owns the queue (queue_manager.DownloadQueue) and the download workers.

Started by the desktop app (Rust) once per session:

    python -m game_download_manager.queue_service --token <random>

It listens on 127.0.0.1 only, on a free port it prints as the first stdout line (`{"port": 51234}`), and every
request must carry the session token in `X-GameAccess-Token`. Orders and state are JSON:

    GET  /state                          queue and every download's phase
    POST /config     {tier, chunkSession} the plan and the PLUS server session
    POST /suspend                         the activation ended: pending downloads pause, nothing starts
    POST /jobs       {appId, name, source, delivery, autoInstalled, keepArchive}
    POST /jobs/<id>/pause | resume | cancel | remove
    POST /jobs/<id>/move {delta}
    POST /shutdown                        the app is closing: stop workers, remember what to resume

Workers keep the file protocol they always had: `<app_id>.json` status and `<app_id>.control.json` orders in
`.cache/digital_downloads/`.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from game_download_manager.queue_manager import DownloadQueue, Job, QueueError

LAUNCHER_DIR = Path(__file__).resolve().parent.parent
STATUS_DIR = LAUNCHER_DIR / ".cache" / "digital_downloads"
CREATE_NO_WINDOW = 0x08000000


def launcher_python() -> str:
    embedded = LAUNCHER_DIR.parent / "python" / "python.exe"
    return str(embedded) if embedded.is_file() else sys.executable


class ProcessWorkers:
    """Real workers: one `digital_downloader.py` process per download, driven through its status/control files."""

    def __init__(self, status_dir: Path = STATUS_DIR):
        self.status_dir = status_dir
        self.processes: dict[int, subprocess.Popen] = {}

    def start(self, job: Job, chunk_session: str | None) -> None:
        self.status_dir.mkdir(parents=True, exist_ok=True)
        for suffix in ("json", "control.json", "passwords.json", "passwords.tmp"):
            (self.status_dir / f"{job.app_id}.{suffix}").unlink(missing_ok=True)
        command = [launcher_python(), str(LAUNCHER_DIR / "digital_downloader.py"),
                   "--app-id", str(job.app_id), "--name", job.name, "--source", job.source]
        if job.delivery == "browser":
            command += ["--source-delivery", "browser"]
        if job.auto_installed:
            command.append("--auto-installed")
        if job.keep_archive:
            command.append("--keep-archive")
        env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
        env.pop("GAMEACCESS_CHUNK_SESSION", None)
        if chunk_session:
            env["GAMEACCESS_CHUNK_SESSION"] = chunk_session  # credentials travel in the environment, never in argv
        flags = CREATE_NO_WINDOW if os.name == "nt" else 0
        self.processes[job.app_id] = subprocess.Popen(
            command, cwd=str(LAUNCHER_DIR), env=env, creationflags=flags,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def control(self, app_id: int, action: str) -> None:
        self.status_dir.mkdir(parents=True, exist_ok=True)
        target = self.status_dir / f"{app_id}.control.json"
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps({"action": action, "requestId": uuid.uuid4().hex}), encoding="utf-8")
        for attempt in range(20):
            try:
                os.replace(temp, target)
                return
            except PermissionError:
                time.sleep(0.05)
        raise OSError("No se pudo enviar la orden al proceso de descarga.")

    def stop(self, app_id: int) -> None:
        """End the worker without cancelling: what it downloaded stays on disk so it can resume later."""
        process = self.processes.pop(app_id, None)
        if process is None or process.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True, creationflags=CREATE_NO_WINDOW)
        else:
            process.kill()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass

    def status(self, app_id: int) -> tuple[dict | None, float | None]:
        path = self.status_dir / f"{app_id}.json"
        try:
            age = time.time() - path.stat().st_mtime
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None, None
        except (OSError, ValueError):
            # A crash can leave the file empty or zero-filled: the worker's own liveness decides.
            return None, None
        return (data if isinstance(data, dict) else None), age

    def alive(self, app_id: int) -> bool:
        process = self.processes.get(app_id)
        return process is not None and process.poll() is None

    def stop_all(self) -> None:
        for app_id in list(self.processes):
            self.stop(app_id)


def make_handler(queue: DownloadQueue, token: str, on_shutdown):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep stdout for the port line only
            pass

        def _reply(self, status: int, body: dict) -> None:
            raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _authorized(self) -> bool:
            if self.headers.get("X-GameAccess-Token") == token:
                return True
            self._reply(401, {"error": "unauthorized"})
            return False

        def _body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            data = json.loads(self.rfile.read(min(length, 1 << 20)).decode("utf-8"))
            return data if isinstance(data, dict) else {}

        def do_GET(self):
            if not self._authorized():
                return
            if self.path == "/state":
                self._reply(200, queue.snapshot())
            else:
                self._reply(404, {"error": "not found"})

        def do_POST(self):
            if not self._authorized():
                return
            try:
                body = self._body()
                if self.path == "/config":
                    queue.configure(body.get("tier"), body.get("chunkSession"))
                elif self.path == "/jobs":
                    queue.enqueue(int(body["appId"]), str(body.get("name") or ""), str(body.get("source") or ""),
                                  str(body.get("delivery") or "download"), bool(body.get("autoInstalled")),
                                  bool(body.get("keepArchive")))
                elif self.path == "/suspend":
                    queue.suspend()
                elif self.path == "/shutdown":
                    self._reply(200, {"ok": True})
                    on_shutdown()
                    return
                else:
                    match = re.fullmatch(r"/jobs/(\d+)/(pause|resume|cancel|remove|move)", self.path)
                    if not match:
                        self._reply(404, {"error": "not found"})
                        return
                    app_id, action = int(match.group(1)), match.group(2)
                    if action == "move":
                        queue.move(app_id, -1 if int(body.get("delta") or 0) < 0 else 1)
                    else:
                        getattr(queue, action)(app_id)
                self._reply(200, queue.snapshot())
            except QueueError as exc:
                self._reply(409, {"error": str(exc)})
            except (KeyError, TypeError, ValueError) as exc:
                self._reply(400, {"error": f"Pedido inválido: {exc}"})

    return Handler


def serve(token: str, status_dir: Path = STATUS_DIR, tick_seconds: float = 0.5) -> None:
    workers = ProcessWorkers(status_dir)
    queue = DownloadQueue(workers, status_dir / "queue.json")
    queue.restore()
    server = ThreadingHTTPServer(("127.0.0.1", 0), None)
    stopping = threading.Event()

    def shutdown() -> None:
        if stopping.is_set():
            return
        stopping.set()
        queue.shutdown()
        threading.Thread(target=server.shutdown, daemon=True).start()

    server.RequestHandlerClass = make_handler(queue, token, shutdown)

    def ticker() -> None:
        while not stopping.wait(tick_seconds):
            try:
                queue.tick()
            except Exception:  # noqa: BLE001 - one bad status must not stop the queue
                pass

    threading.Thread(target=ticker, daemon=True, name="download-queue-tick").start()
    # The app watches this process: if the app dies without saying goodbye, stdin closes and we stop too.
    def watch_parent() -> None:
        try:
            sys.stdin.read()
        except Exception:  # noqa: BLE001
            pass
        shutdown()

    threading.Thread(target=watch_parent, daemon=True, name="download-queue-parent").start()
    sys.stdout.write(json.dumps({"port": server.server_address[1]}) + "\n")
    sys.stdout.flush()
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        shutdown()
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser(description="GameAccess Download Manager: the download queue for one app session")
    parser.add_argument("--token", default=os.environ.get("GAMEACCESS_QUEUE_TOKEN", ""))
    args = parser.parse_args()
    if len(args.token) < 16:
        print("A session token of at least 16 characters is required.", file=sys.stderr)
        return 2
    serve(args.token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
