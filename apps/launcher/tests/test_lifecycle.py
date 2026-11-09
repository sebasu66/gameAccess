"""On demand: a game's whole life in Game Access, end to end, on a copy of the launcher with its own games folder.

    $env:GAMEACCESS_LIFECYCLE = "1"; .venv\\Scripts\\python.exe -m pytest tests\\test_lifecycle.py -v

(or `run_lifecycle_tests.ps1`). Not part of the normal run: it downloads, unpacks and compresses for real (a few
seconds). Phases, in the order the app goes through them:
download (local web server) -> unpack -> set up (Game Execution Manager) -> "-ready" folder -> "completed" ->
in the library -> verification -> freeze -> thaw -> deep freeze -> thaw -> uninstall.
Needs Windows and the portable 7-Zip (freezing); nothing of the PC's library is touched."""
import hashlib
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from launcher_copy import copy_launcher, game_zip, run_downloader, serve  # noqa: E402

import game_journal as journal  # noqa: E402
from digital_process_runner import DigitalProcessRunner  # noqa: E402
from game_download_manager.extractor import find_portable_7z  # noqa: E402
from game_library_manager import GameLibraryManager  # noqa: E402
from game_library_manager.freezer import DEEP_SUFFIX, GameFreezer, deep_archive_for  # noqa: E402
from game_library_manager.run_checks import RunChecks  # noqa: E402
from game_library_manager.storage import DigitalGameStorage  # noqa: E402

pytestmark = [
    pytest.mark.skipif(not os.environ.get("GAMEACCESS_LIFECYCLE"), reason="on demand: set GAMEACCESS_LIFECYCLE=1"),
    pytest.mark.skipif(sys.platform != "win32" or not find_portable_7z(), reason="needs Windows and 7-Zip"),
]

APP_ID, NAME = 7, "Fixture"
# The game's log, in the order an install writes it (pipeline.py).
INSTALL_STEPS = [("descarga", "inicio"), ("descarga", "terminada"), ("descompresión", "empieza"), ("descompresión", "terminada"), ("estado", "ready")]


def digest(folder: Path) -> dict:
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file() and p.name != journal.JOURNAL_FILE and not p.name.endswith(DEEP_SUFFIX)}


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


@pytest.fixture()
def installed(tmp_path, monkeypatch):
    """Phase 1 to 5: the real downloader brings the game in, unpacks it, sets it up and marks it ready."""
    monkeypatch.delenv("GAMEACCESS_LAUNCHER_DATA", raising=False)
    launcher = copy_launcher(tmp_path)
    game_zip(tmp_path / "source", NAME)
    with serve(tmp_path / "source") as url:
        result = run_downloader(launcher, APP_ID, NAME, f"{url}/fixture.zip")
    assert result.returncode == 0, result.stderr[-3000:]
    return launcher, DigitalGameStorage(launcher)


def test_the_whole_life_of_a_game(installed, monkeypatch):
    launcher, storage = installed

    # Download and install: "completed" comes last, over a "-ready" folder with the game unpacked and set up.
    status = json.loads((launcher / ".cache" / "digital_downloads" / f"{APP_ID}.json").read_text(encoding="utf-8"))
    assert status["phase"] == "completed"
    folder = storage.folder(APP_ID, NAME)
    assert folder.name == f"{APP_ID}-{NAME}-ready" and folder.parent == storage.root
    assert (folder / f"{NAME}.exe").is_file() and (folder / "data" / "levels" / "level5.txt").is_file()
    assert not any(p.suffix == ".zip" for p in folder.rglob("*")), "the archive is deleted after unpacking"
    log = journal.read(folder)
    positions = [log.find(f"| {step} | {detail}") for step, detail in INSTALL_STEPS]
    assert all(pos >= 0 for pos in positions) and positions == sorted(positions), log
    downloads_log = (launcher / "logs" / "downloads.log").read_text(encoding="utf-8")
    for expected in ["extraction starting", "extraction finished", "DESCARGA COMPLETADA"]:
        assert expected in downloads_log

    # In the library: installed, ready, no issues.
    assert storage.status(APP_ID, NAME)["installed"]
    runner = DigitalProcessRunner(storage)
    library = GameLibraryManager(storage, freezer=GameFreezer(storage, is_running=lambda _: False))
    entry = next(game for game in library.list_games() if game["app_id"] == APP_ID)
    assert entry["installed"] and entry["state"] == "ready" and not entry.get("partial")
    original = digest(folder)

    # Verification: the game is started, stays open, is checked and closed (the play itself is simulated).
    import game_execution_manager.game_processes as processes
    closed = []
    monkeypatch.setattr(processes, "close_all", lambda items: closed.extend(i["pid"] for i in items) or ([NAME], []))
    calls = {"n": 0}

    def probe(_):
        calls["n"] += 1
        return [] if calls["n"] == 1 else [{"pid": 5, "name": NAME, "path": str(folder / f"{NAME}.exe"), "responding": True}]
    with patch.object(runner, "run", lambda action, *args, **kwargs: {"ok": True}):
        clock = Clock()
        verdict = runner.verify_run(APP_ID, NAME, probe=probe, sleep=clock.sleep, clock=clock)
    assert verdict["check"]["state"] == "checked" and closed == [5]
    assert RunChecks(storage.launcher).get(APP_ID)["state"] == "checked"

    # Freeze, thaw, deep freeze, thaw: always the same game, byte for byte; installed all along.
    with patch.object(GameFreezer, "_target", lambda self, app_id, name: storage.folder(app_id, name)):
        frozen = runner.run("freeze", APP_ID, NAME)["frozen"]
        assert frozen["level"] == "freeze" and frozen["stored_bytes"] < frozen["original_bytes"]
        assert digest(folder) == original and storage.status(APP_ID, NAME)["installed"]
        assert runner.run("thaw", APP_ID, NAME)["thawed"] is True
        assert digest(folder) == original

        deep = runner.run("deep-freeze", APP_ID, NAME)["frozen"]
        assert deep["level"] == "deep" and deep["stored_bytes"] < deep["original_bytes"]
        assert sorted(p.name for p in folder.iterdir()) == sorted([deep_archive_for(folder).name, journal.JOURNAL_FILE])
        assert storage.status(APP_ID, NAME)["installed"], "a deep frozen game stays in the library"
        assert runner.run("thaw", APP_ID, NAME)["thawed"] is True
        assert digest(folder) == original and not deep_archive_for(folder).exists()

        # Uninstall: the folder goes, the library no longer has it, nothing of its freezing is left.
        assert runner.run("uninstall", APP_ID, NAME)["ok"]
    assert not folder.exists()
    assert not storage.status(APP_ID, NAME)["installed"]
    assert not any(game["app_id"] == APP_ID for game in library.list_games())
    assert not (storage.data / ".cache" / "digital_frozen" / f"{APP_ID}.json").exists()
