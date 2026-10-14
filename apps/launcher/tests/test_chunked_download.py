import hashlib
import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chunked_download as cd


class Ctx:
    def __init__(self):
        self.cancelled = threading.Event()
        self.progress = []

    def wait_if_paused(self):
        pass

    def emit_progress(self, *args):
        self.progress.append(args)


class Resp:
    def __init__(self, status=200, body=None, data=b"", headers=None):
        self.status_code, self._body, self.data, self.headers = status, body, data, headers or {"content-type": "application/octet-stream"}

    def json(self):
        return self._body

    def iter_content(self, chunk_size=1):
        yield self.data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeServer:
    """Pretends to be the GameAccess API plus ViKiNG for one job."""

    def __init__(self, files, piece_size, ready_after_polls=0, corrupt_once=None):
        self.files = files  # list of (name, bytes)
        self.pieces = []
        for fi, (_, data) in enumerate(files):
            for start in range(0, len(data), piece_size):
                self.pieces.append((fi, start, data[start:start + piece_size]))
        self.polls = 0
        self.ready_after_polls = ready_after_polls
        self.corrupt_once = corrupt_once
        self.status = "running"
        self.calls = []

    def manifest(self):
        self.polls += 1
        ready_count = len(self.pieces) if self.polls > self.ready_after_polls else 0
        return {
            "job_id": "abcdef123456", "status": "ready" if ready_count == len(self.pieces) else "running", "error": "",
            "item_name": "Portal 2", "total_bytes": sum(len(d) for _, d in self.files),
            "files": [{"index": i, "name": n, "size": len(d)} for i, (n, d) in enumerate(self.files)],
            "piece_count": len(self.pieces), "ready_count": ready_count,
            "pieces": [
                {"index": i, "file_index": fi, "start": s, "size": len(d), "sha256": hashlib.sha256(d).hexdigest() if i < ready_count else "", "ready": i < ready_count}
                for i, (fi, s, d) in enumerate(self.pieces)
            ],
        }

    def request(self, method, url, headers=None, timeout=None, json=None):
        self.calls.append((method, url))
        assert headers["Authorization"] == "Bearer tok" and headers["X-GameAccess-Installation"] == "inst"
        if method == "POST":
            return Resp(200, self.manifest())
        if url.endswith("/link"):
            index = int(url.split("/pieces/")[1].split("/")[0])
            return Resp(200, {"index": index, "url": f"https://cdn/{index}"})
        return Resp(200, self.manifest())

    def get(self, url, stream=True, timeout=None, allow_redirects=True):
        index = int(url.rsplit("/", 1)[1])
        data = self.pieces[index][2]
        if self.corrupt_once == index:
            self.corrupt_once = None
            data = b"x" * len(data)
        return Resp(200, data=data)


def make(server, tmp_path):
    ctx = Ctx()
    session = cd.ChunkSession("https://api", "tok", "inst")
    return cd.ChunkedDownloader(ctx, session, http=server, sleep=lambda s: None), ctx


def test_single_file_is_assembled_and_nothing_is_left_behind(tmp_path):
    data = bytes(range(256)) * 1000
    server = FakeServer([("Portal.rar", data)], 70_000, ready_after_polls=2)
    downloader, ctx = make(server, tmp_path)
    result = downloader.download("magnet:?xt=urn:btih:" + "a" * 40, "Portal 2", str(tmp_path), "1", "Portal 2")
    assert Path(result).read_bytes() == data
    assert sorted(p.name for p in tmp_path.iterdir()) == ["Portal.rar"]  # no .part dir, no state file
    assert ctx.progress[-1][1] == "downloading" and ctx.progress[-1][3] == len(data)


def test_several_files_go_to_a_folder(tmp_path):
    server = FakeServer([("a.bin", b"A" * 1000), ("b.bin", b"B" * 500)], 400)
    downloader, _ = make(server, tmp_path)
    folder = Path(downloader.download("https://x/y.zip", "Mi Juego", str(tmp_path), "1", "Mi Juego"))
    assert folder.name == "Mi Juego"
    assert (folder / "a.bin").read_bytes() == b"A" * 1000 and (folder / "b.bin").read_bytes() == b"B" * 500
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".ga-")]


def test_a_corrupt_piece_is_downloaded_again(tmp_path):
    data = b"hello world" * 5000
    server = FakeServer([("f.bin", data)], 20_000, corrupt_once=1)
    downloader, _ = make(server, tmp_path)
    result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data


def test_cancel_removes_temporary_files_and_state(tmp_path):
    data = b"z" * 100_000
    server = FakeServer([("f.bin", data)], 30_000)
    downloader, ctx = make(server, tmp_path)
    original = server.get

    def cancel_after_first(url, **kw):
        ctx.cancelled.set()
        return original(url, **kw)

    server.get = cancel_after_first
    assert downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F") == ""
    assert list(tmp_path.iterdir()) == []


def test_failure_leaves_no_files_either(tmp_path):
    server = FakeServer([("f.bin", b"q" * 50_000)], 20_000)
    downloader, _ = make(server, tmp_path)
    server.get = lambda url, **kw: Resp(500)
    with pytest.raises(cd.ChunkedDownloadError):
        downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert list(tmp_path.iterdir()) == []


def test_an_interrupted_download_resumes_without_repeating_finished_pieces(tmp_path):
    data = bytes(range(200)) * 500
    server = FakeServer([("f.bin", data)], 30_000)
    downloader, _ = make(server, tmp_path)
    original = server.get
    served = []

    def crash_on_third(url, **kw):
        index = int(url.rsplit("/", 1)[1])
        if index == 2:
            raise KeyboardInterrupt  # simulates the app being killed, not a retryable error
        served.append(index)
        return original(url, **kw)

    server.get = crash_on_third
    with pytest.raises(KeyboardInterrupt):
        downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    state = json.loads(next(tmp_path.glob(".ga-state-*.json")).read_text())
    assert state["done"] == [0, 1]

    server.get = original
    again = []
    server.get = lambda url, **kw: (again.append(int(url.rsplit("/", 1)[1])), original(url, **kw))[1]
    result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data
    assert 0 not in again and 1 not in again
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".ga-")]


def test_server_refusal_means_use_the_normal_download(tmp_path):
    class Refusing(FakeServer):
        def request(self, *a, **k):
            return Resp(403, {})

    downloader, _ = make(Refusing([("f", b"1")], 1), tmp_path)
    with pytest.raises(cd.ChunkedDownloadUnavailable):
        downloader.download("https://x", "F", str(tmp_path), "1", "F")


def test_a_failed_job_without_pieces_raises(tmp_path):
    class Failed(FakeServer):
        def manifest(self):
            m = super().manifest()
            m.update(status="failed", error="torbox_no_files", pieces=[], ready_count=0)
            return m

    downloader, _ = make(Failed([("f", b"1")], 1), tmp_path)
    with pytest.raises(cd.ChunkedDownloadError):
        downloader.download("https://x", "F", str(tmp_path), "1", "F")


def test_session_from_env():
    s = cd.ChunkSession.from_env(json.dumps({"api": "https://a/", "token": "t", "installation": "i"}))
    assert s == cd.ChunkSession("https://a", "t", "i")
    assert cd.ChunkSession.from_env("nope") is None
    assert cd.ChunkSession.from_env(json.dumps({"api": "", "token": "t", "installation": "i"})) is None
