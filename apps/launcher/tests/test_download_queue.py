import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from game_download_manager.queue_manager import STALE_SECONDS, DownloadQueue, QueueError
from game_download_manager.queue_service import make_handler

MAGNET = "magnet:?xt=urn:btih:" + "a" * 40


class FakeWorkers:
    """Workers that do what they are told and report what a test sets."""

    def __init__(self):
        self.started, self.controls, self.stopped = [], [], []
        self.statuses: dict[int, tuple[dict, float]] = {}
        self.dead: set[int] = set()
        self.sessions = []

    def start(self, job, chunk_session):
        self.started.append(job.app_id)
        self.sessions.append(chunk_session)
        self.dead.discard(job.app_id)

    def control(self, app_id, action):
        self.controls.append((app_id, action))

    def stop(self, app_id):
        self.stopped.append(app_id)
        self.dead.add(app_id)

    def status(self, app_id):
        return self.statuses.get(app_id, (None, None))

    def alive(self, app_id):
        return app_id not in self.dead

    def report(self, app_id, phase, age=0.0, **extra):
        self.statuses[app_id] = ({"phase": phase, **extra}, age)


def queue(tier="base", state_file=None):
    workers = FakeWorkers()
    q = DownloadQueue(workers, state_file)
    q.configure(tier, "session" if tier == "plus" else None)
    return q, workers


def phases(q):
    return {job["appId"]: job["phase"] for job in q.snapshot()["jobs"]}


def test_base_runs_one_download_and_keeps_the_rest_in_order():
    q, w = queue("base")
    for app_id in (1, 2, 3):
        q.enqueue(app_id, f"G{app_id}", MAGNET)
    assert w.started == [1]
    assert [job["position"] for job in q.snapshot()["jobs"]] == [-1, 0, 1]
    w.report(1, "completed")
    q.tick()
    assert w.started == [1, 2] and phases(q)[1] == "completed" and phases(q)[3] == "queued"


def test_plus_runs_four_and_gets_the_server_session():
    q, w = queue("plus")
    for app_id in range(1, 7):
        q.enqueue(app_id, f"G{app_id}", MAGNET)
    assert w.started == [1, 2, 3, 4] and set(w.sessions) == {"session"}
    q.enqueue(5, "G5", MAGNET)  # asking again for a queued game changes nothing
    assert w.started == [1, 2, 3, 4]


def test_base_never_sends_the_server_session_and_only_takes_torrents():
    q, w = queue("base")
    q.enqueue(1, "G1", MAGNET)
    assert w.sessions == [None]
    with pytest.raises(QueueError):
        q.enqueue(2, "G2", "https://host/game.zip")
    with pytest.raises(QueueError):
        q.enqueue(3, "G3", "")


def test_without_a_plan_nothing_starts_and_upgrading_admits_more():
    q, w = queue(None)
    for app_id in range(1, 6):
        q.enqueue(app_id, f"G{app_id}", MAGNET)
    assert w.started == []
    q.configure("base", None)
    assert w.started == [1]
    q.configure("plus", "session")
    assert w.started == [1, 2, 3, 4]
    q.configure("base", None)  # downgrading keeps the running ones but admits no more
    w.report(1, "completed")
    q.tick()
    assert w.started == [1, 2, 3, 4]


def test_pausing_frees_the_place_and_resuming_waits_for_one():
    q, w = queue("base")
    q.enqueue(1, "G1", MAGNET)
    q.enqueue(2, "G2", MAGNET)
    w.report(1, "downloading")
    q.pause(1)
    assert (1, "pause") in w.controls and w.started == [1, 2]  # game 2 took the place
    w.report(1, "paused")
    q.tick()
    assert phases(q)[1] == "paused"
    q.resume(1)
    assert phases(q)[1] == "queued" and (1, "resume") not in w.controls
    w.report(2, "completed")
    q.tick()
    assert (1, "resume") in w.controls and w.started == [1, 2]  # the same worker resumes, no new download


def test_a_queued_download_can_be_paused_without_a_worker_and_the_order_changed():
    q, w = queue("base")
    for app_id in (1, 2, 3, 4):
        q.enqueue(app_id, f"G{app_id}", MAGNET)
    q.move(4, -1)
    q.move(4, -1)
    q.move(4, -1)  # already first: stays
    q.pause(3)
    assert [j["appId"] for j in sorted(q.snapshot()["jobs"], key=lambda j: j["position"]) if j["position"] >= 0] == [4, 2]
    assert w.controls == []
    w.report(1, "completed")
    q.tick()
    assert w.started == [1, 4]


def test_cancel_queued_and_running_downloads():
    q, w = queue("base")
    q.enqueue(1, "G1", MAGNET)
    q.enqueue(2, "G2", MAGNET)
    q.cancel(2)
    assert phases(q)[2] == "cancelled" and w.started == [1]
    q.cancel(1)
    assert (1, "cancel") in w.controls and phases(q)[1] == "cancelling"
    w.report(1, "cancelled")
    q.tick()
    assert phases(q)[1] == "cancelled"
    q.remove(1)
    assert 1 not in phases(q)


def test_only_finished_downloads_can_be_removed():
    q, _ = queue("base")
    q.enqueue(1, "G1", MAGNET)
    with pytest.raises(QueueError):
        q.remove(1)


def test_a_dead_or_silent_worker_is_reported_and_its_place_freed():
    q, w = queue("plus")
    q.enqueue(1, "G1", MAGNET)
    q.enqueue(2, "G2", MAGNET)
    w.dead.add(1)
    w.report(2, "downloading", age=STALE_SECONDS + 1)
    q.tick()
    assert phases(q) == {1: "interrupted", 2: "interrupted"}
    assert 2 in w.stopped
    assert q.running() == 0


def test_closing_the_app_resumes_running_downloads_first_and_keeps_paused_ones(tmp_path):
    state = tmp_path / "queue.json"
    q, w = queue("base", state)
    for app_id in (1, 2, 3):
        q.enqueue(app_id, f"G{app_id}", MAGNET)
    q.pause(3)
    w.report(1, "downloading")
    q.tick()
    q.shutdown()
    assert w.stopped == [1]

    again = DownloadQueue(FakeWorkers(), state)
    again.restore()
    assert phases(again) == {1: "queued", 2: "queued", 3: "paused"}
    again.configure("base", None)
    assert again.workers.started == [1]  # the one that was running comes back first


def test_when_the_activation_ends_everything_pauses_and_nothing_starts():
    q, w = queue("plus")
    for app_id in (1, 2, 3, 4, 5):
        q.enqueue(app_id, f"G{app_id}", MAGNET)
    q.suspend()
    assert sorted(app_id for app_id, action in w.controls if action == "pause") == [1, 2, 3, 4]
    assert {job["state"] for job in q.snapshot()["jobs"]} == {"paused"} and phases(q)[5] == "paused"  # running ones show "paused" once their worker confirms
    w.report(1, "completed")
    q.tick()
    assert w.started == [1, 2, 3, 4]  # no place is refilled without a plan
    q.configure("plus", "session")
    q.resume(5)
    assert w.started == [1, 2, 3, 4, 5]


def test_the_local_service_requires_the_session_token():
    q, w = queue("base")
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(q, "t" * 20, lambda: None))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"

    def call(path, body=None, token="t" * 20):
        request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                         headers={"X-GameAccess-Token": token, "Content-Type": "application/json"},
                                         method="GET" if body is None else "POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read())

    try:
        with pytest.raises(urllib.error.HTTPError) as refused:
            call("/state", token="wrong")
        assert refused.value.code == 401
        state = call("/jobs", {"appId": 7, "name": "G7", "source": MAGNET})
        assert state["jobs"][0]["appId"] == 7 and w.started == [7]
        with pytest.raises(urllib.error.HTTPError) as conflict:
            call("/jobs", {"appId": 8, "name": "G8", "source": "https://host/g.zip"})
        assert conflict.value.code == 409 and "torrent" in json.loads(conflict.value.read())["error"]
        assert call("/jobs/7/pause", {})["jobs"][0]["state"] == "paused"
    finally:
        server.shutdown()
        server.server_close()


def test_after_plus_ends_a_torrent_resumes_in_base_but_a_direct_link_waits_for_plus():
    q, w = queue("plus")
    q.enqueue(1, "Torrent", MAGNET)
    q.enqueue(2, "Direct", "https://host/game.zip")
    q.suspend()                      # PLUS ended: everything pauses...
    q.configure("base", None)        # ...and the app goes on in free mode
    states = lambda: {job["appId"]: job["state"] for job in q.snapshot()["jobs"]}
    assert states() == {1: "paused", 2: "paused"}
    q.resume(1)
    assert states()[1] == "active"
    with pytest.raises(QueueError, match="Plus"):
        q.resume(2)
    assert states()[2] == "paused"
    q.configure("plus", "session")
    q.resume(2)
    assert states()[2] == "active"
