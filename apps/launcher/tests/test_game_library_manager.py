import sys
from pathlib import Path
from unittest.mock import patch
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_journal as journal
from game_library_manager.storage import DigitalGameStorage
from digital_process_runner import DigitalProcessRunner
from game_library_manager import GameLibraryManager
from disk_space import folder_size, GIB

def library(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    ready = storage.set_status(1, "Alpha", "ready") if storage.register(1, "Alpha") else None
    (ready / "Alpha.exe").write_bytes(b"x" * 1000)
    journal.note(ready, "play", "lanzado: Alpha.exe (pid 1)")
    journal.note(ready, "play", "lanzado: Alpha.exe (pid 2)")
    broken = storage.register(2, "Beta")
    (broken / "pack.zip").write_bytes(b"y" * 10)
    return storage, GameLibraryManager(storage)

def test_list_reports_state_size_warning_and_plays(tmp_path):
    storage, lib = library(tmp_path)
    games = {g["app_id"]: g for g in lib.list_games()}
    assert games[1]["state"] == "ready" and games[1]["installed"] and games[1]["warning"] == ""
    assert games[1]["size_bytes"] >= 1000 and games[1]["plays"] == 2 and games[1]["last_played"]
    assert games[2]["state"] == "legacy" and games[2]["needs_repair"] and "comprimidos" in games[2]["warning"]
    summary = lib.summary()
    assert summary["count"] == 2 and summary["needs_repair"] == 1 and summary["disk_free_bytes"] > 0
    assert summary["used_bytes"] >= 1010 and summary["by_state"]["ready"] == 1

def test_space_check_blocks_when_unpacking_would_not_fit(tmp_path):
    storage, lib = library(tmp_path)
    class Usage:  # 10 GB free
        total, used, free = 100 * GIB, 90 * GIB, 10 * GIB
    with patch("disk_space.shutil.disk_usage", return_value=Usage):
        assert lib.check_space(3 * GIB)["ok"]                      # 3*2 + 1 = 7 GB <= 10
        refused = lib.check_space(6 * GIB)                          # 6*2 + 1 = 13 GB > 10
    assert not refused["ok"] and "No hay espacio" in refused["message"] and "13.0 GB" in refused["message"]

def test_batch_uninstall_and_repair_continue_after_failures(tmp_path):
    storage, lib = library(tmp_path)
    results = lib.batch("repair", [2, 99])
    assert results[0]["ok"] is False and "comprimidos" in results[0]["error"] and results[1]["error"].startswith("El juego no")
    removed = lib.batch("uninstall", [1, 2])
    assert all(r["ok"] for r in removed) and lib.list_games() == []
    with pytest.raises(ValueError):
        lib.batch("format", [1])

def test_connectors_report_missing_modules(tmp_path):
    storage, lib = library(tmp_path)
    with pytest.raises(NotImplementedError):
        lib.freeze(1, "Alpha")

def test_runner_actions_expose_the_library(tmp_path):
    storage, lib = library(tmp_path)
    runner = DigitalProcessRunner(storage)
    listed = runner.run("library-list", 0, "")
    assert listed["ok"] and len(listed["library"]) == 2 and listed["summary"]["count"] == 2
    assert runner.run("library-space", 0, "", '{"bytes": 1}')["space"]["ok"]
    done = runner.run("library-batch", 0, "", '{"action": "analyze", "app_ids": [1]}')
    assert done["results"][0]["analysis"]["ready"]
    assert folder_size(tmp_path / "games") > 0


def test_unfinished_download_is_never_offered_a_fix(tmp_path):
    storage, lib = library(tmp_path)
    temporary = Path(storage.preferences.load()["temporary_root"])
    pieces = temporary / "2-Beta-downloading"
    pieces.mkdir(parents=True)
    (pieces / ".ga-state-abcd1234.json").write_text("{}", "utf-8")
    (pieces / "data.bin").write_bytes(b"z" * 5)
    games = {g["app_id"]: g for g in lib.list_games()}
    assert games[2]["unfinished"] and games[2]["transfer_kind"] == "pieces" and not games[1]["unfinished"]
    plan = lib.plan([2])[0]
    assert plan["actions"] == [] and "descarga" in plan["error"]
    result = lib.batch("adopt", [2])[0]
    assert not result["ok"] and "descarga" in result["error"]
    assert pieces.exists()
    (pieces / ".ga-state-abcd1234.json").unlink()
    assert {g["app_id"]: g for g in lib.list_games()}[2]["transfer_kind"] == "other"


def test_the_install_keeps_the_name_its_download_source_gave_it(tmp_path):
    storage, lib = library(tmp_path)
    storage.set_source(1, "Alpha v1.2 - Repack", "SteamRIP")
    storage.set_status(1, "Alpha", "ERROR")          # moving or renaming the folder keeps the source
    storage.set_status(1, "Alpha", "ready")
    games = {g["app_id"]: g for g in lib.list_games()}
    assert (games[1]["source_title"], games[1]["source_provider"]) == ("Alpha v1.2 - Repack", "SteamRIP")
    assert games[2]["source_title"] == ""             # downloaded before sources were recorded


def test_a_download_waiting_in_the_queue_cannot_be_fixed_or_marked_ready(tmp_path):
    storage, lib = library(tmp_path)
    queue = storage.data / ".cache" / "digital_downloads" / "queue.json"
    queue.parent.mkdir(parents=True, exist_ok=True)
    queue.write_text('{"order": [2], "jobs": [{"app_id": 2, "state": "waiting"}]}', encoding="utf-8")
    games = {g["app_id"]: g for g in lib.list_games()}
    assert games[2]["queued"] and games[2]["unfinished"] and not games[1]["unfinished"]
    assert lib.plan([2])[0]["error"] and lib.plan([2])[0]["actions"] == []
    assert lib.batch("adopt", [2])[0]["ok"] is False
