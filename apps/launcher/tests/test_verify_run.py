import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from digital_process_runner import DigitalProcessRunner
from game_library_manager.run_checks import RunChecks
from game_library_manager.storage import DigitalGameStorage


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def runner(tmp_path, played_ok=True):
    storage = DigitalGameStorage(tmp_path)
    storage.register(60, "Verify fixture")
    instance = DigitalProcessRunner(storage)
    instance.run = lambda action, *args, **kwargs: {"ok": True} if played_ok else {"ok": False, "error": "boom"}
    return instance, storage


def verify(instance, probe, clock):
    return instance.verify_run(60, "Verify fixture", probe=probe, sleep=clock.sleep, clock=clock)


def process(pid=5):
    return {"pid": pid, "name": "game", "path": "x", "responding": True}


def test_a_game_that_stays_open_is_checked_and_closed(tmp_path, monkeypatch):
    instance, storage = runner(tmp_path)
    clock = Clock()
    closed = []
    import game_execution_manager.game_processes as gp
    monkeypatch.setattr(gp, "close_all", lambda items: closed.extend(i["pid"] for i in items) or (["game"], []))
    calls = {"n": 0}

    def probe(_):
        calls["n"] += 1
        return [] if calls["n"] == 1 else [process()]  # not running at the start, then open

    result = verify(instance, probe, clock)
    assert result["check"]["state"] == "checked"
    assert RunChecks(storage.launcher).get(60)["state"] == "checked"
    assert closed == [5]


def test_a_game_that_closes_by_itself_cant_run(tmp_path, monkeypatch):
    instance, storage = runner(tmp_path)
    import game_execution_manager.game_processes as gp
    monkeypatch.setattr(gp, "close_all", lambda items: ([], []))
    clock = Clock()
    answers = iter([[], [process()], [process()], []])
    result = verify(instance, lambda _: next(answers, []), clock)
    assert result["check"]["state"] == "cantRun" and "closed by itself" in result["check"]["detail"]


def test_a_game_that_never_shows_up_cant_run(tmp_path):
    instance, _ = runner(tmp_path)
    result = verify(instance, lambda _: [], Clock())
    assert result["check"]["state"] == "cantRun" and "no game process" in result["check"]["detail"]


def test_a_game_that_fails_to_start_says_why(tmp_path):
    instance, _ = runner(tmp_path, played_ok=False)
    result = verify(instance, lambda _: [], Clock())
    assert result["check"] == {**result["check"], "state": "cantRun", "detail": "boom"}


def test_a_game_already_running_is_left_alone(tmp_path):
    instance, storage = runner(tmp_path)
    result = verify(instance, lambda _: [process()], Clock())
    assert result["skipped"] == "running"
    assert RunChecks(storage.launcher).get(60) is None


def test_the_library_list_carries_the_verdict(tmp_path):
    from game_library_manager import GameLibraryManager
    instance, storage = runner(tmp_path)
    (storage.folder(60, "Verify fixture") / "game.exe").write_bytes(b"x")
    RunChecks(storage.launcher).save(60, "checked", "ok", 12)
    games = GameLibraryManager(storage).list_games(with_sizes=False)
    assert next(g for g in games if g["app_id"] == 60)["run_check"]["state"] == "checked"
