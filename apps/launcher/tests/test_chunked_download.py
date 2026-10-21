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
    monkeypatch.setattr(cd, "INFLIGHT_POLL_SECONDS", 0.0)


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

    def get(self, url, stream=True, timeout=None, allow_redirects=True, headers=None):
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


class ForgetfulServer(FakeServer):
    """Loses the job once (a restarted server) after the first piece was handed out."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.posts, self.fetched, self.forgot = [], [], False

    def request(self, method, url, headers=None, timeout=None, json=None):
        if method == "POST":
            self.posts.append(json)
        elif self.fetched and not self.forgot and "/links" not in url and "/link" not in url:
            self.forgot = True
            self.calls.append((method, url))
            return Resp(404, {"detail": "No existe esa descarga."})
        return super().request(method, url, headers=headers, timeout=timeout, json=json)

    def get(self, url, **kw):
        self.fetched.append(int(url.rsplit("/", 1)[1]))
        return super().get(url, **kw)


def test_a_server_that_lost_the_job_is_asked_again_with_the_pieces_already_on_disk(tmp_path):
    data = bytes(range(256)) * 400
    server = ForgetfulServer([("f.bin", data)], 25_600)
    downloader, _ = make(server, tmp_path)
    result = downloader.download("magnet:?xt=urn:btih:" + "b" * 40, "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data
    assert server.forgot and len(server.posts) == 2
    assert server.posts[0]["have_pieces"] == [] and server.posts[1]["have_pieces"] == [0]
    assert sorted(server.fetched) == [0, 1, 2, 3]  # no piece was downloaded twice


def test_pieces_from_an_interrupted_run_are_kept_when_the_plan_is_the_same(tmp_path):
    data = bytes(range(256)) * 400
    source = "magnet:?xt=urn:btih:" + "c" * 40
    server = ForgetfulServer([("f.bin", data)], 25_600)
    server.forgot = True  # this one does not lose the job
    downloader, _ = make(server, tmp_path)
    plan = {i: (0, i * 25_600, 25_600) for i in range(4)}
    (tmp_path / "f.bin").write_bytes(data[:51_200] + b"\0" * (len(data) - 51_200))
    key = hashlib.sha1(source.encode()).hexdigest()
    downloader._save_state(tmp_path / f".ga-state-{key[:12]}.json", source, "oldjob", {0, 1}, plan)
    result = downloader.download(source, "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data
    assert server.posts[0]["have_pieces"] == [0, 1] and sorted(server.fetched) == [2, 3]


def test_a_partial_job_is_resumed_for_the_pieces_this_player_lacks(tmp_path):
    data = b"p" * 4000
    server = FakeServer([("f.bin", data)], 1000)
    posts = []
    plain_manifest = server.manifest

    def manifest():
        m = plain_manifest()
        if not posts[1:]:  # until the player asks again, piece 3 was skipped (another player had it)
            m["status"] = "partial"
            m["pieces"][3]["ready"], m["pieces"][3]["sha256"] = False, ""
        return m

    server.manifest = manifest
    original = server.request

    def request(method, url, headers=None, timeout=None, json=None):
        if method == "POST":
            posts.append(json)
        return original(method, url, headers=headers, timeout=timeout, json=json)

    server.request = request
    downloader, _ = make(server, tmp_path)
    assert Path(downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")).read_bytes() == data
    assert posts[1]["have_pieces"] == [0, 1, 2]


class RangedServer(FakeServer):
    """ViKiNG honouring ranges, streaming in small blocks; `slow` connections (by start byte) crawl."""

    def __init__(self, *args, slow_starts=(), refuse_extra=False, ignore_ranges=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.slow_starts, self.refuse_extra, self.ignore_ranges = set(slow_starts), refuse_extra, ignore_ranges
        self.lock = threading.Lock()
        self.active = self.peak = 0
        self.served = {}   # start byte -> bytes sent

    def get(self, url, stream=True, timeout=None, allow_redirects=True, headers=None):
        import time as _time

        index = int(url.rsplit("/", 1)[1])
        data = self.pieces[index][2]
        first, last = (int(x) for x in headers["Range"].split("=")[1].split("-"))
        server = self
        if self.ignore_ranges:
            return Resp(200, data=data)
        with self.lock:
            if self.refuse_extra and self.active >= 2:
                return Resp(429)
            self.active += 1
            self.peak = max(self.peak, self.active)

        class Streamed(Resp):
            def iter_content(self, chunk_size=1):
                try:
                    for at in range(first, last + 1, 16_384):
                        _time.sleep(0.05 if first in server.slow_starts else 0.002)
                        block = data[at:min(at + 16_384, last + 1)]
                        with server.lock:
                            server.served[first] = server.served.get(first, 0) + len(block)
                        yield block
                finally:
                    with server.lock:
                        server.active -= 1

        return Streamed(206, data=b"", headers={"content-type": "application/octet-stream",
                                                "content-range": f"bytes {first}-{last}/{len(data)}"})


@pytest.fixture
def small_splits(monkeypatch):
    monkeypatch.setattr(cd, "MIN_SPLIT_BYTES", 32_768)


def test_a_piece_is_downloaded_over_several_range_connections(tmp_path, small_splits):
    data = bytes(range(256)) * 4096  # 1 MB, one piece
    server = RangedServer([("f.bin", data)], len(data))
    downloader, _ = make(server, tmp_path)
    result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data
    assert 2 <= server.peak <= cd.CONNECTIONS_PER_PIECE
    assert list(tmp_path.iterdir()) == [Path(result)]


def test_a_slow_connection_hands_its_bytes_to_faster_ones(tmp_path, small_splits):
    data = bytes(range(256)) * 4096
    server = RangedServer([("f.bin", data)], len(data), slow_starts={0})  # the first connection crawls
    downloader, _ = make(server, tmp_path)
    result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data
    assert server.served[0] < len(data) / 4  # the others took most of what it started with


def test_a_server_that_ignores_ranges_sends_the_piece_on_one_connection(tmp_path, small_splits):
    data = bytes(range(256)) * 4096
    server = RangedServer([("f.bin", data)], len(data), ignore_ranges=True)
    downloader, _ = make(server, tmp_path)
    assert Path(downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")).read_bytes() == data


def test_too_many_connections_429_only_lowers_the_connections(tmp_path, small_splits):
    data = bytes(range(256)) * 4096
    server = RangedServer([("f.bin", data)], len(data), refuse_extra=True)
    downloader, _ = make(server, tmp_path)
    assert Path(downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")).read_bytes() == data
    assert server.peak <= 2


def test_connections_are_shared_by_all_pieces(tmp_path, small_splits, monkeypatch):
    monkeypatch.setenv("GAMEACCESS_CHUNK_CONNECTIONS", "3")
    data = bytes(range(256)) * 4096
    server = RangedServer([("f.bin", data)], len(data) // 4)
    downloader, _ = make(server, tmp_path, parallel=4)
    assert Path(downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")).read_bytes() == data
    assert server.peak <= 3


class ImportedServer(RangedServer):
    """Remote mode: one piece per file, imported by ViKiNG, so the manifest carries no hash."""

    def manifest(self):
        body = super().manifest()
        for piece in body["pieces"]:
            piece["sha256"] = ""
        return body


def test_whole_files_imported_by_viking_go_straight_into_place(tmp_path, small_splits):
    first, second = bytes(range(256)) * 4096, bytes(range(255, -1, -1)) * 1024
    server = ImportedServer([("a.rar", first), ("b.rar", second)], 10 ** 9)  # one piece per file
    downloader, _ = make(server, tmp_path, parallel=2)
    result = downloader.download("https://x/f.bin", "Game", str(tmp_path), "1", "Game")
    folder = Path(result)
    assert (folder / "a.rar").read_bytes() == first and (folder / "b.rar").read_bytes() == second
    assert server.peak >= 2  # split over several connections like any piece
    assert not [p for p in tmp_path.rglob("*") if p.name.endswith(".part") or p.name.startswith(".ga-")]


def test_a_short_imported_file_is_downloaded_again(tmp_path, small_splits):
    data = bytes(range(256)) * 1024
    server = ImportedServer([("a.rar", data)], 10 ** 9)
    original, cut = server.get, {"left": 1}

    def short_once(url, **kw):
        response = original(url, **kw)
        if cut["left"] and response.status_code == 206:
            cut["left"] -= 1
            return Resp(206, data=data[:10], headers=response.headers)  # the connection drops after 10 bytes
        return response

    server.get = short_once
    downloader, _ = make(server, tmp_path)
    assert Path(downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")).read_bytes() == data


class SealedTorboxServer(ImportedServer):
    """While ViKiNG imports, the server hands out TorBox links sealed for the player's session."""

    sealed_for = "tok"

    def request(self, method, url, headers=None, timeout=None, json=None):
        if url.split("?")[0].endswith("/link"):
            from game_download_manager.link_sealing import seal
            index = int(url.split("/pieces/")[1].split("/")[0])
            secret = f"https://cdn/{index}?token=account-api-key"
            return Resp(200, {"index": index, "source": "torbox", "sealed": seal(secret, self.sealed_for, "inst")})
        return super().request(method, url, headers=headers, timeout=timeout, json=json)

    def get(self, url, **kw):
        assert url.endswith("?token=account-api-key")  # the player opened the sealed link
        return super().get(url.split("?")[0], **kw)


def test_a_sealed_torbox_link_is_opened_in_memory_and_never_logged(tmp_path, small_splits, caplog):
    import logging
    data = bytes(range(256)) * 2048
    server = SealedTorboxServer([("a.rar", data)], 10 ** 9)
    downloader, _ = make(server, tmp_path)
    with caplog.at_level(logging.DEBUG, logger="digital_downloader"):
        result = downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
    assert Path(result).read_bytes() == data
    assert "account-api-key" not in caplog.text and "token=" not in caplog.text
    assert "desde torbox (cdn)" in caplog.text


def test_a_link_sealed_for_another_session_is_refused(tmp_path, small_splits):
    data = bytes(range(256)) * 1024
    server = SealedTorboxServer([("a.rar", data)], 10 ** 9)
    server.sealed_for = "someone-else"
    downloader, _ = make(server, tmp_path)
    with pytest.raises((cd.ChunkedDownloadError, cd.ChunkedDownloadUnavailable)):
        downloader.download("https://x/f.bin", "F", str(tmp_path), "1", "F")
