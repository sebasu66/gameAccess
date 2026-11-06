"""The freezer on a small generated game, with the real Windows compression and 7-Zip."""
import hashlib
import os
import json
import sys
import time
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_journal as journal
from digital_process_runner import DigitalProcessRunner
from game_download_manager.extractor import find_portable_7z
from game_library_manager import GameLibraryManager
from game_library_manager.freezer import DEEP_SUFFIX, GameFreezer, deep_archive_for, folder_on_disk
from game_library_manager.storage import DigitalGameStorage

pytestmark = pytest.mark.skipif(sys.platform != "win32" or not find_portable_7z(), reason="needs Windows and 7-Zip")
DAY = 86400


def game(tmp_path, app_id=1, name="Alpha"):
    storage = DigitalGameStorage(tmp_path)
    storage.register(app_id, name)
    folder = storage.set_status(app_id, name, "ready")
    (folder / f"{name}.exe").write_bytes(b"MZ" + b"\0" * 4000)
    data = folder / "data" / "levels"
    data.mkdir(parents=True)
    for i in range(6):  # text compresses well: the levels below must save space
        (data / f"level{i}.txt").write_text(("level %d: the quick brown fox jumps over the lazy dog\n" % i) * 20000, encoding="utf-8")
    journal.note(folder, "play", f"lanzado: {name}.exe (pid 1)")
    return storage, folder


def digest(folder):
    skip = {journal.JOURNAL_FILE}
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file() and p.name not in skip and not p.name.endswith(DEEP_SUFFIX)}


def freezer(storage, **kw):
    return GameFreezer(storage, is_running=lambda folder: False, **kw)


def test_windows_compression_keeps_the_game_playable_and_the_library_shows_both_sizes(tmp_path):
    storage, folder = game(tmp_path)
    before = digest(folder)
    record = freezer(storage).freeze(1, "Alpha")
    assert record["level"] == "freeze" and record["stored_bytes"] < record["original_bytes"]
    assert digest(folder) == before and storage.status(1, "Alpha")["installed"]  # read as it is, nothing to thaw
    lib = GameLibraryManager(storage, freezer=freezer(storage))
    entry = next(g for g in lib.list_games() if g["app_id"] == 1)
    assert entry["frozen"] == "freeze" and entry["frozen_bytes"] < entry["size_bytes"] == record["original_bytes"]
    summary = lib.summary()
    assert summary["used_bytes"] < record["original_bytes"] and summary["frozen_saved_bytes"] == record["original_bytes"] - entry["frozen_bytes"]
    assert freezer(storage).thaw(1, "Alpha") == {"thawed": True, "level": "freeze"}
    assert folder_on_disk(folder) >= record["original_bytes"] and freezer(storage).record(1) is None


def test_a_game_compressed_without_a_record_is_detected_and_can_be_thawed(tmp_path):
    """A freeze whose record never got written (closed app, older version) or compression done by hand."""
    import subprocess
    storage, folder = game(tmp_path)
    subprocess.run(["compact.exe", "/c", f"/s:{folder}", "/i", "/q", "/exe:LZX"], capture_output=True, check=True)
    assert freezer(storage).record(1) is None
    lib = GameLibraryManager(storage, freezer=freezer(storage))
    entry = next(g for g in lib.list_games() if g["app_id"] == 1)
    assert entry["frozen"] == "freeze" and entry["frozen_bytes"] < entry["original_bytes"] == entry["size_bytes"]
    assert freezer(storage).thaw(1, "Alpha") == {"thawed": True, "level": "freeze"}
    assert folder_on_disk(folder) >= entry["original_bytes"]
    assert "frozen" not in next(g for g in lib.list_games() if g["app_id"] == 1)


def test_deep_freeze_keeps_only_the_archive_and_the_log_and_thaws_back_byte_for_byte(tmp_path):
    storage, folder = game(tmp_path)
    before = digest(folder)
    record = freezer(storage).deep_freeze(1, "Alpha")
    assert sorted(p.name for p in folder.iterdir()) == sorted([deep_archive_for(folder).name, journal.JOURNAL_FILE])
    assert record["stored_bytes"] < record["original_bytes"] / 3
    assert storage.status(1, "Alpha")["installed"]  # still in the library as installed
    lib = GameLibraryManager(storage, freezer=freezer(storage))
    entry = next(g for g in lib.list_games() if g["app_id"] == 1)
    assert entry["frozen"] == "deep" and entry["issues"] == [] and entry["size_bytes"] == record["original_bytes"]
    assert lib.batch("repair", [1])[0]["error"].startswith("Está en congelado profundo")
    assert freezer(storage).ensure_thawed(1, "Alpha") is True
    assert digest(folder) == before and not deep_archive_for(folder).exists()
    assert "descongelado" in journal.read(folder) and "lanzado: Alpha.exe" in journal.read(folder)


def test_a_failed_archive_check_deletes_nothing(tmp_path):
    storage, folder = game(tmp_path)
    before = digest(folder)
    frozen = freezer(storage)
    with patch.object(GameFreezer, "_listed_bytes", return_value=1):
        with pytest.raises(RuntimeError, match="no se borra nada"):
            frozen.deep_freeze(1, "Alpha")
    assert digest(folder) == before and frozen.record(1) is None
    assert not any(p.name.startswith(deep_archive_for(folder).name) for p in folder.iterdir())


def test_linked_open_or_cramped_games_are_refused(tmp_path):
    storage, folder = game(tmp_path)
    with pytest.raises(ValueError, match="está abierto"):
        GameFreezer(storage, is_running=lambda f: True).freeze(1, "Alpha")

    class Usage:
        total, used, free = 10, 10, 0
    with patch("game_library_manager.freezer.shutil.disk_usage", return_value=Usage):
        with pytest.raises(ValueError, match="No hay espacio"):
            freezer(storage).deep_freeze(1, "Alpha")
    with patch.object(storage.linked, "get", return_value={"path": str(folder)}):
        with pytest.raises(ValueError, match="vinculado"):
            freezer(storage).freeze(1, "Alpha")


def test_automatic_freezing_follows_the_days_without_play(tmp_path):
    storage, folder = game(tmp_path)
    played = time.time()
    clock = {"now": played + 10 * DAY}
    auto = freezer(storage, now=lambda: clock["now"])
    assert auto.auto() == []                                   # used 10 days ago: nothing
    clock["now"] = played + 40 * DAY
    assert auto.auto() == [{"app_id": 1, "ok": True, "level": "freeze"}]
    assert auto.auto() == []                                   # already at that level
    clock["now"] = played + 100 * DAY
    assert auto.auto() == [{"app_id": 1, "ok": True, "level": "deep"}]
    assert auto.record(1)["level"] == "deep"


def test_runner_freezes_thaws_and_forgets_on_uninstall(tmp_path):
    storage, folder = game(tmp_path)
    runner = DigitalProcessRunner(storage)
    # The runner builds its own freezer; in the test no game is running.
    with patch.object(GameFreezer, "_target", lambda self, app_id, name: storage.folder(app_id, name)):
        assert runner.run("deep-freeze", 1, "Alpha")["frozen"]["level"] == "deep"
        assert runner.run("thaw", 1, "Alpha")["thawed"] is True
        assert runner.run("freeze", 1, "Alpha")["frozen"]["level"] == "freeze"
        assert runner.run("uninstall", 1, "Alpha")["ok"]
    assert not (storage.data / ".cache" / "digital_frozen" / "1.json").exists()


def test_each_level_writes_its_progress_for_the_console(tmp_path):
    storage, folder = game(tmp_path)
    progress = storage.data / ".cache" / "digital_frozen" / "1.progress.json"
    freezer(storage, workers=3).freeze(1, "Alpha")
    state = json.loads(progress.read_text(encoding="utf-8"))
    assert state["action"] == "freeze" and state["finished"] and state["ok"] and state["percent"] == 100
    kinds = [event["kind"] for event in state["events"]]
    assert kinds[:2] == ["start", "files"] and {"kind": "threads", "count": 3} in [{k: e[k] for k in ("kind", "count") if k in e} for e in state["events"]]
    assert kinds[-1] == "done" and state["events"][-1]["stored"] < state["events"][-1]["original"]
    freezer(storage).thaw(1, "Alpha")
    freezer(storage).deep_freeze(1, "Alpha")
    state = json.loads(progress.read_text(encoding="utf-8"))
    assert state["action"] == "deep" and state["ok"] and [e["name"] for e in state["events"] if e["kind"] == "step"] == ["compress", "verify", "clear"]
    assert "archived" in [e["kind"] for e in state["events"]] and "verified" in [e["kind"] for e in state["events"]]
    freezer(storage).thaw(1, "Alpha")
    state = json.loads(progress.read_text(encoding="utf-8"))
    assert state["action"] == "thaw-deep" and state["ok"]


def test_a_failure_is_written_as_the_end_of_the_progress(tmp_path):
    storage, folder = game(tmp_path)

    class Usage:
        total, used, free = 10, 10, 0
    with patch("game_library_manager.freezer.shutil.disk_usage", return_value=Usage):
        with pytest.raises(ValueError):
            freezer(storage).deep_freeze(1, "Alpha")
    state = json.loads((storage.data / ".cache" / "digital_frozen" / "1.progress.json").read_text(encoding="utf-8"))
    assert state["finished"] and state["ok"] is False and state["events"][-1]["kind"] == "failed" and "espacio" in state["events"][-1]["error"]


# -- edge cases: one at a time, cancel, pause, a closed app -----------------------------------------
from game_library_manager import freeze_control
from game_library_manager.freeze_control import FreezeBusy, FreezeCancelled, FreezeControl
from game_library_manager.freezer import compressed_sizes


def records(storage):
    return storage.data / ".cache" / "digital_frozen"


def test_one_freeze_at_a_time_and_a_lock_left_by_a_dead_process_is_taken_over(tmp_path):
    storage, folder = game(tmp_path)
    records(storage).mkdir(parents=True, exist_ok=True)
    other = FreezeControl(records(storage), 2)
    other.acquire("freeze")
    (records(storage) / "freeze.lock").write_text(json.dumps({"pid": 99999999, "app_id": 2, "action": "freeze"}))  # its process is gone
    assert freezer(storage).freeze(1, "Alpha")["level"] == "freeze"
    assert not (records(storage) / "freeze.lock").exists()                     # released at the end
    import subprocess
    alive = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        (records(storage) / "freeze.lock").write_text(json.dumps({"pid": alive.pid, "app_id": 2, "action": "deep"}))
        with pytest.raises(FreezeBusy):
            freezer(storage).thaw(1, "Alpha")
        assert freezer(storage).record(1)["level"] == "freeze"                   # untouched
        # Play on a deep-frozen game goes ahead of the work holding the lock (it is paused meanwhile).
        (records(storage) / "freeze.lock").unlink()
        freezer(storage).thaw(1, "Alpha")
        freezer(storage).deep_freeze(1, "Alpha")
        (records(storage) / "freeze.lock").write_text(json.dumps({"pid": alive.pid, "app_id": 2, "action": "deep"}))
        assert freezer(storage).ensure_thawed(1, "Alpha") is True
    finally:
        alive.kill()


def test_a_cancelled_freeze_puts_the_game_back_as_it_was(tmp_path, monkeypatch):
    storage, folder = game(tmp_path)
    before = digest(folder)
    monkeypatch.setattr(FreezeControl, "cancelled", lambda self: True)
    with pytest.raises(FreezeCancelled):
        freezer(storage).freeze(1, "Alpha")
    assert compressed_sizes(folder) is None and digest(folder) == before and freezer(storage).record(1) is None
    with pytest.raises(FreezeCancelled):
        freezer(storage).deep_freeze(1, "Alpha")
    assert digest(folder) == before and not any(p.name.startswith(deep_archive_for(folder).name) for p in folder.iterdir())
    state = json.loads((records(storage) / "1.progress.json").read_text(encoding="utf-8"))
    assert state["finished"] and state["cancelled"] and "cancelado" in journal.read(folder)
    assert not (records(storage) / "freeze.lock").exists()


def test_a_cancelled_deep_thaw_leaves_the_game_frozen(tmp_path, monkeypatch):
    storage, folder = game(tmp_path)
    before = digest(folder)
    freezer(storage).deep_freeze(1, "Alpha")
    monkeypatch.setattr(FreezeControl, "cancelled", lambda self: True)
    with pytest.raises(FreezeCancelled):
        freezer(storage).thaw(1, "Alpha")
    assert sorted(p.name for p in folder.iterdir()) == sorted([deep_archive_for(folder).name, journal.JOURNAL_FILE]) and freezer(storage).is_deep(1)
    monkeypatch.undo()
    freezer(storage).thaw(1, "Alpha")
    assert digest(folder) == before


def test_the_work_waits_while_paused(tmp_path):
    storage, _ = game(tmp_path)
    records(storage).mkdir(parents=True, exist_ok=True)
    (records(storage) / "freeze.pause").write_text("")
    waits = []
    control = FreezeControl(records(storage), 1, sleep=lambda seconds: waits.append(seconds) or (records(storage) / "freeze.pause").unlink())
    control.checkpoint()
    assert waits == [0.5]


def test_after_a_closed_app_each_cut_freeze_is_put_back_in_a_safe_state(tmp_path):
    storage, folder = game(tmp_path)
    before = digest(folder)
    dead = 99999999

    def cut(action, **extra):
        records(storage).mkdir(parents=True, exist_ok=True)
        (records(storage) / "1.progress.json").write_text(json.dumps({"action": action, "pid": dead, "folder": str(folder), "percent": 42, "finished": False, **extra}))
    # A deep freeze cut while compressing: the half-made archive goes, the game was never touched.
    deep_archive_for(folder).with_name(deep_archive_for(folder).name + ".tmp").write_bytes(b"half")
    cut("deep")
    assert freezer(storage).recover() == [{"app_id": 1, "action": "deep", "percent": 42, "outcome": "discarded"}]
    assert digest(folder) == before and not deep_archive_for(folder).with_name(deep_archive_for(folder).name + ".tmp").exists()
    assert freezer(storage).recover() == []                                   # reported once
    # A deep freeze cut while removing the files: the archive is complete, the removal ends.
    record = freezer(storage).deep_freeze(1, "Alpha")
    freezer(storage).thaw(1, "Alpha")
    freezer(storage).deep_freeze(1, "Alpha")
    (folder / "leftover.txt").write_text("x")
    saved = freezer(storage).record(1)
    freezer(storage)._save(1, {**saved, "phase": "clearing"})
    cut("deep")
    assert freezer(storage).recover()[0]["outcome"] == "completed"
    assert not (folder / "leftover.txt").exists() and "phase" not in freezer(storage).record(1)
    freezer(storage).thaw(1, "Alpha")
    assert digest(folder) == before
    # A normal freeze cut short can go on: the files already compressed are skipped.
    cut("freeze")
    assert freezer(storage).recover()[0]["outcome"] == "resumable"
    assert "interrumpido al 42 %" in journal.read(folder)
    # A freeze whose process still runs is only reported.
    cut("freeze", pid=os.getpid())
    assert freezer(storage).recover()[0]["outcome"] == "running"


def test_nothing_else_touches_a_game_while_it_is_frozen(tmp_path):
    storage, folder = game(tmp_path)
    records(storage).mkdir(parents=True, exist_ok=True)
    import subprocess
    alive = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        (records(storage) / "freeze.lock").write_text(json.dumps({"pid": alive.pid, "app_id": 1, "action": "freeze"}))
        refused = DigitalProcessRunner(storage).run("uninstall", 1, "Alpha")
        assert refused["ok"] is False and "Se está congelando" in refused["error"]
        assert GameLibraryManager(storage, freezer=freezer(storage)).batch("uninstall", [1])[0]["error"].startswith("Se está congelando")
        assert folder.is_dir()
    finally:
        alive.kill()
