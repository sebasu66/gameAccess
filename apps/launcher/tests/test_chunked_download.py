import hashlib
import json
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from game_download_manager import chunked as cd


@pytest.fixture(autouse=True)
def fast_polling(monkeypatch):
    monkeypatch.setattr(cd, "POLL_SECONDS", 0.0)


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
        if url.split("?")[0].endswith("/link"):
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


def make(server, tmp_path, parallel=1):
    ctx = Ctx()
    session = cd.ChunkSession("https://api", "tok", "inst")
    return cd.ChunkedDownloader(ctx, session, http=server, sleep=lambda s: None, parallel=parallel), ctx


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


def test_waiting_message_explains_what_the_server_is_doing():
    assert "buscando fuentes" in cd.describe_wait({"stage": "torbox", "progress": 0, "seeds": 0})
    assert "42%" in cd.describe_wait({"stage": "torbox", "progress": 42.4, "seeds": 3}) and "3 fuentes" in cd.describe_wait({"stage": "torbox", "progress": 42.4, "seeds": 3})
    assert "armando" in cd.describe_wait({"stage": "torbox", "progress": 100, "state": "cached"})
    assert cd.describe_wait(None).startswith("Preparando")


def test_server_refusal_means_use_the_normal_download(tmp_path):
    class Refusing(FakeServer):
        def request(self, *a, **k):
            return Resp(403, {})

    downloader, _ = make(Refusing([("f", b"1")], 1), tmp_path)
    with pytest.raises(cd.ChunkedDownloadUnavailable):
        downloader.download("https://x", "F", str(tmp_path), "1", "F")


def test_links_are_asked_for_in_batches_and_an_old_server_falls_back(tmp_path):
    downloader, _ = make(FakeServer([("f", b"1")], 1), tmp_path, parallel=2)
    calls = []

    def batch_call(method, path, **kw):
        calls.append(path)
        start = int(path.split("start=")[1].split("&")[0])
        return {"links": [{"index": i, "url": f"u{i}"} for i in range(start, start + 4)]}

    downloader._call = batch_call
    assert [downloader.piece_link("job", i)["url"] for i in range(4)] == ["u0", "u1", "u2", "u3"]
    assert calls == ["/downloads/viking-chunks/job/links?start=0&count=4"]  # one call for four pieces

    downloader.piece_link("job", 0, refresh=True)  # the link did not work: the server is told to give a new one
    assert calls[-1] == "/downloads/viking-chunks/job/links?start=0&count=1&refresh=true"

    old, _ = make(FakeServer([("f", b"1")], 1), tmp_path)
    seen = []

    def old_call(method, path, **kw):
        seen.append(path)
        if "/links" in path:
            raise cd.ChunkedDownloadUnavailable("404")
        return {"index": 0, "url": "single"}

    old._call = old_call
    assert old.piece_link("job", 0)["url"] == "single"
    old.piece_link("job", 1)
    assert sum("/links" in p for p in seen) == 1  # it stops trying the batch endpoint


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


def test_a_server_that_is_down_for_a_while_is_waited_for(tmp_path):
    data = b"abc" * 10_000
    server = FakeServer([("f.bin", data)], 20_000)
    real = server.request
    state = {"fails": 3}

    def flaky(method, url, **kw):
        if state["fails"] > 0:
            state["fails"] -= 1
            raise cd.requests.ConnectionError("refused")
        return real(method, url, **kw)

    server.request = flaky
    downloader, _ = make(server, tmp_path)
    result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data


def test_a_server_that_never_comes_back_fails_cleanly(tmp_path, monkeypatch):
    monkeypatch.setattr(cd, "NETWORK_RETRIES", 3)
    server = FakeServer([("f.bin", b"1" * 100)], 50)
    server.request = lambda *a, **k: (_ for _ in ()).throw(cd.requests.ConnectionError("refused"))
    downloader, _ = make(server, tmp_path)
    with pytest.raises(cd.ChunkedDownloadError):
        downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert list(tmp_path.iterdir()) == []


def test_a_job_stopped_by_a_server_restart_is_resumed_by_the_player(tmp_path):
    data = bytes(range(100)) * 600
    server = FakeServer([("f.bin", data)], 20_000)
    original_manifest = server.manifest
    state = {"restarted": False, "posts": 0}

    def manifest():
        m = original_manifest()
        if not state["restarted"] and server.polls >= 2:
            m.update(status="failed", error="server_restarted", ready_count=0)
            for p in m["pieces"]:
                p["ready"], p["sha256"] = False, ""
        return m

    real_request = server.request

    def request(method, url, **kw):
        if method == "POST":
            state["posts"] += 1
            state["restarted"] = state["posts"] >= 2
        return real_request(method, url, **kw)

    server.manifest, server.request = manifest, request
    downloader, _ = make(server, tmp_path)
    result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data and state["posts"] == 2


def test_several_pieces_are_downloaded_at_the_same_time(tmp_path):
    import time as _time

    data = bytes(range(250)) * 2000
    server = FakeServer([("f.bin", data)], 50_000)
    original = server.get
    state = {"active": 0, "peak": 0}
    lock = threading.Lock()

    class Slow(Resp):
        def iter_content(self, chunk_size=1):
            with lock:
                state["active"] += 1
                state["peak"] = max(state["peak"], state["active"])
            _time.sleep(0.05)
            yield self.data
            with lock:
                state["active"] -= 1

    server.get = lambda url, **kw: (lambda r: Slow(200, data=r.data))(original(url, **kw))
    downloader, ctx = make(server, tmp_path, parallel=4)
    result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data
    assert state["peak"] >= 2
    assert list(tmp_path.iterdir()) == [Path(result)]


def test_torbox_hiccups_are_resumed_but_a_dead_source_is_not():
    for code in ("torbox_timeout", "torbox_unavailable", "torbox_server_error", "torbox_wait_timeout"):
        assert code in cd.RESUMABLE_ERRORS
    assert "torbox_stalled" not in cd.RESUMABLE_ERRORS
    assert "nadie la comparte" in cd.ERROR_WORDS["torbox_stalled"]


def test_waiting_text_shows_speed_and_time_left_from_torbox():
    text = cd.describe_wait({"stage": "torbox", "progress": 37.2, "seeds": 4, "speed": 8_000_000, "eta": 720})
    assert "37%" in text and "4 fuentes" in text and "8.0 MB/s" in text and "12 min" in text
