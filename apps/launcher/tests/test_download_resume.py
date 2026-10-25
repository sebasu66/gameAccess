"""A stopped download goes on from the step it reached (download or extract) instead of starting over, and a download
that will not fit on disk stops before it starts."""
import logging
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import disk_space
from game_download_manager import pipeline as pipeline_module
from game_download_manager.pipeline import DownloadPipeline, NoSpaceError
from game_download_manager.queue_manager import DownloadQueue, QueueError
from game_library_manager import storage as storage_module
from game_library_manager.storage import DigitalGameStorage

GIB = disk_space.GIB
MAGNET = "magnet:?xt=urn:btih:" + "a" * 40


# ------------------------------------------------------------------ the install remembers the step

def test_the_install_remembers_the_step_and_the_source(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    storage.register(7, "Game")
    storage.set_resume(7, "download", source=MAGNET, source_title="Game v1 - Repack", source_provider="Feed")
    assert storage.resume_point(7)["step"] == "download"
    archive = tmp_path / "game.rar"
    archive.write_bytes(b"rar")
    storage.set_resume(7, "extract", archive=str(archive), error="no room")
    point = storage.resume_point(7)
    # The later step keeps the source it came from.
    assert (point["step"], point["archive"], point["source"], point["source_title"], point["error"]) == ("extract", str(archive), MAGNET, "Game v1 - Repack", "no room")
    storage.clear_resume(7)
    assert storage.resume_point(7) == {}


def test_an_extract_step_whose_archive_is_gone_goes_back_to_the_download(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    storage.register(7, "Game")
    storage.set_resume(7, "extract", source=MAGNET, archive=str(tmp_path / "gone.rar"))
    assert storage.resume_point(7)["step"] == "download"


def test_a_game_without_an_install_record_remembers_nothing(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    storage.set_resume(9, "download", source=MAGNET)
    assert storage.resume_point(9) == {}


# ------------------------------------------------------------------ free space before the transfer

def disks(monkeypatch, free_by_path):
    monkeypatch.setattr(disk_space, "disk_info", lambda path: {"disk_total_bytes": 0, "disk_free_bytes": free_by_path(Path(path))})


def test_on_one_disk_the_download_and_its_unpacking_add_up(monkeypatch, tmp_path):
    disks(monkeypatch, lambda path: 20 * GIB)
    assert disk_space.check_download(8 * GIB, 0, tmp_path / "games", tmp_path / "temp")["ok"]
    room = disk_space.check_download(10 * GIB, 0, tmp_path / "games", tmp_path / "temp")
    assert not room["ok"] and "dlNoSpace" in room["message"]


def test_what_already_arrived_counts(monkeypatch, tmp_path):
    disks(monkeypatch, lambda path: 20 * GIB)
    # 10 GB to unpack and 6 still to download (4 are here) fit in 20 GB with the margin.
    assert disk_space.check_download(10 * GIB, 4 * GIB, tmp_path / "games", tmp_path / "temp")["ok"]


# ------------------------------------------------------------------ the Download Manager retries

class Workers:
    def __init__(self):
        self.started = []

    def start(self, job, session):
        self.started.append(job)

    def control(self, *args):
        pass

    def stop(self, app_id):
        pass

    def status(self, app_id):
        return None, None

    def alive(self, app_id):
        return True


def test_a_failed_download_is_retried_with_its_own_source():
    workers = Workers()
    q = DownloadQueue(workers)
    q.configure("base", None)
    q.enqueue(5, "Game", MAGNET, source_title="Game v1")
    q._finish(q.jobs[5], "error", "no room")
    q.retry(5)
    assert [job.source_title for job in workers.started] == ["Game v1", "Game v1"]
    assert q.jobs[5].state == "active"


def test_after_a_restart_the_retry_comes_from_what_the_install_remembers():
    workers = Workers()
    q = DownloadQueue(workers, resume_point=lambda app_id: {"step": "extract", "source": MAGNET, "name": "Game", "source_title": "Game v1"})
    q.configure("base", None)
    q.retry(5)
    assert (workers.started[0].name, workers.started[0].source, workers.started[0].source_title) == ("Game", MAGNET, "Game v1")


def test_nothing_to_go_on_with_is_refused():
    q = DownloadQueue(Workers())
    q.configure("base", None)
    with pytest.raises(QueueError):
        q.retry(5)


# ------------------------------------------------------------------ the worker goes on from the unpacking

class Ctx:
    def __init__(self, launcher):
        self.launcher_dir = launcher
        self.cancelled = threading.Event()
        self.logger = logging.getLogger("test-resume")
        self.temp_files, self.cancel_hooks, self.events, self.errors = [], [], [], []
        self.room_check = None

    def emit_progress(self, *args, **kwargs):
        self.events.append(kwargs.get("phase") or args[1])

    def emit_error(self, *args, **kwargs):
        self.errors.append(args)

    def wait_if_paused(self):
        pass

    def set_route(self, route):
        pass

    def set_room_check(self, check):
        self.room_check = check


def run_pipeline(monkeypatch, tmp_path, *, download=None, extract=None):
    monkeypatch.delenv("GAMEACCESS_CHUNK_SESSION", raising=False)
    monkeypatch.setattr(storage_module, "DigitalGameStorage", lambda: DigitalGameStorage(tmp_path))
    from game_execution_manager import GameExecutionManager
    from game_execution_manager import executables
    monkeypatch.setattr(GameExecutionManager, "prepare", lambda self, *args: None)
    monkeypatch.setattr(executables, "not_a_game", lambda folder: [])
    ended = []
    context = Ctx(tmp_path)

    def cleanup(error_message=None, error_code="", error_detail=None, resume_step=""):
        ended.append((error_message, error_code, resume_step))

    p = DownloadPipeline(context, watch_controls=lambda: None, cleanup_on_cancel=cleanup,
                         download_http=None, download_torrent=download, extract_archives=extract)
    args = SimpleNamespace(appId=7, name="Game", destination_dir=None, extract_only=None, download_source=MAGNET,
                           source_delivery="download", source_title="Game v1", source_provider="Feed",
                           auto_installed=False, password=None, connections=1)
    try:
        p.run(args)
    except SystemExit as stop:
        ended.append(("exit", stop.code, ""))
    return context, ended


def test_an_unpacking_that_failed_goes_on_without_downloading_again(monkeypatch, tmp_path):
    def download(**kwargs):
        archive = Path(kwargs["dest_dir"]) / "game.rar"
        archive.write_bytes(b"rar")
        return str(archive)

    def broken(**kwargs):
        raise OSError("disk full")

    context, ended = run_pipeline(monkeypatch, tmp_path, download=download, extract=broken)
    assert ended[-1][2] == "extract"
    storage = DigitalGameStorage(tmp_path)
    assert storage.resume_point(7)["step"] == "extract"

    def unpack(**kwargs):
        (Path(kwargs["dest_dir"]) / "game.exe").write_bytes(b"MZ")
        return True

    context, ended = run_pipeline(monkeypatch, tmp_path, download=lambda **kw: pytest.fail("it was already downloaded"), extract=unpack)
    assert ended[-1] == ("exit", 0, "")
    assert storage.resume_point(7) == {}


def test_a_download_that_will_not_fit_stops_and_keeps_its_step(monkeypatch, tmp_path):
    def download(**kwargs):
        raise NoSpaceError({"ok": False, "needed_bytes": 2, "free_bytes": 1, "message": "⟦dlNoSpaceGames⟧"})

    context, ended = run_pipeline(monkeypatch, tmp_path, download=download)
    assert ended[-1] == ("⟦dlNoSpaceGames⟧", "no_space", "download")
    assert DigitalGameStorage(tmp_path).resume_point(7)["source"] == MAGNET
