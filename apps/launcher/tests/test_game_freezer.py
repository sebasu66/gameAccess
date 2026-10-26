"""The freezer on a small generated game, with the real Windows compression and 7-Zip."""
import hashlib
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
from game_library_manager.freezer import DEEP_ARCHIVE, GameFreezer, folder_on_disk
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
    skip = {journal.JOURNAL_FILE, DEEP_ARCHIVE}
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file() and p.name not in skip}


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
    assert sorted(p.name for p in folder.iterdir()) == sorted([DEEP_ARCHIVE, journal.JOURNAL_FILE])
    assert record["stored_bytes"] < record["original_bytes"] / 3
    assert storage.status(1, "Alpha")["installed"]  # still in the library as installed
    lib = GameLibraryManager(storage, freezer=freezer(storage))
    entry = next(g for g in lib.list_games() if g["app_id"] == 1)
    assert entry["frozen"] == "deep" and entry["issues"] == [] and entry["size_bytes"] == record["original_bytes"]
    assert lib.batch("repair", [1])[0]["error"].startswith("Está en congelado profundo")
    assert freezer(storage).ensure_thawed(1, "Alpha") is True
    assert digest(folder) == before and not (folder / DEEP_ARCHIVE).exists()
    assert "descongelado" in journal.read(folder) and "lanzado: Alpha.exe" in journal.read(folder)


def test_a_failed_archive_check_deletes_nothing(tmp_path):
    storage, folder = game(tmp_path)
    before = digest(folder)
    frozen = freezer(storage)
    with patch.object(GameFreezer, "_listed_bytes", return_value=1):
        with pytest.raises(RuntimeError, match="no se borra nada"):
            frozen.deep_freeze(1, "Alpha")
    assert digest(folder) == before and frozen.record(1) is None
    assert not any(p.name.startswith(DEEP_ARCHIVE) for p in folder.iterdir())


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
