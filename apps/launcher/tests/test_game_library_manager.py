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

def test_the_library_has_a_freezer(tmp_path):
    storage, lib = library(tmp_path)
    assert lib.freezer.record(1) is None and lib.thaw(1, "Alpha") == {"thawed": False}

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


def test_the_player_can_rename_a_game_in_their_library_only(tmp_path):
    storage, lib = library(tmp_path)
    runner = DigitalProcessRunner(storage)
    assert runner.run("set-label", 1, "Alpha", "  Alpha   (la de Juan) ")["label"] == "Alpha (la de Juan)"
    storage.set_status(1, "Alpha", "ERROR")                  # the label survives folder renames
    games = {g["app_id"]: g for g in lib.list_games()}
    assert games[1]["label"] == "Alpha (la de Juan)" and games[1]["name"] == "Alpha"
    assert storage.set_label(2, "Beta", "Beta mod") == "Beta mod"   # a legacy folder without a record gets one
    linked = tmp_path / "outside" / "Gamma"
    linked.mkdir(parents=True)
    storage.linked.link(3, "Gamma", str(linked))
    storage.set_label(3, "Gamma", "Gamma de Steam")
    assert {g["app_id"]: g for g in lib.list_games()}[3]["label"] == "Gamma de Steam"
    assert storage.linked.get(3)["path"] == str(linked.resolve())   # the link itself is unchanged
    storage.set_label(1, "Alpha", "")                         # empty: back to the source's name
    assert {g["app_id"]: g for g in lib.list_games()}[1]["label"] == ""
    with pytest.raises(ValueError):
        storage.set_label(99, "Nope", "x")


def test_space_check_counts_what_an_unfinished_download_already_has(tmp_path):
    storage, lib = library(tmp_path)
    transfer = storage.transfer_folder(7, "Big")
    transfer.mkdir(parents=True)
    (transfer / "part.bin").write_bytes(b"z" * (4 * 1024 * 1024))
    class Usage:  # 10 GB free
        total, used, free = 100 * GIB, 90 * GIB, 10 * GIB
    with patch("disk_space.shutil.disk_usage", return_value=Usage), \
         patch("game_library_manager.manager.allocated_size", return_value=4 * GIB):
        assert not lib.check_space(6 * GIB)["ok"]                   # a new download: 6*2 + 1 = 13 GB > 10
        resumed = lib.check_space(6 * GIB, 7, "Big")                # (6-4) + 6 + 1 = 9 GB <= 10
    assert resumed["ok"] and resumed["needed_bytes"] == 9 * GIB


def test_clean_empty_keeps_the_record_of_an_unfinished_download(tmp_path):
    storage, lib = library(tmp_path)
    failed = storage.set_status(7, "Big", "ERROR") if storage.register(7, "Big") else None
    transfer = storage.transfer_folder(7, "Big")
    transfer.mkdir(parents=True)
    (transfer / "part.bin").write_bytes(b"z" * 10)
    lib.clean_empty()
    assert failed.is_dir() and (storage.registry / "7.json").is_file()


def test_a_linked_folder_game_can_be_deleted_from_disk_but_never_a_steam_one_or_a_shared_folder(tmp_path):
    storage, lib = library(tmp_path)
    delta = tmp_path / "outside" / "Delta"
    delta.mkdir(parents=True)
    (delta / "Delta.exe").write_bytes(b"x" * 100)
    storage.linked.link(4, "Delta", str(delta))
    result = lib.batch("linked_delete", [4])[0]
    assert result["ok"] and not delta.exists() and storage.linked.get(4) is None
    steam = tmp_path / "steamapps" / "common" / "Epsilon"
    steam.mkdir(parents=True)
    storage.linked.link(5, "Epsilon", str(steam), "steam")
    assert not lib.batch("linked_delete", [5])[0]["ok"] and steam.is_dir()
    # A folder that holds another linked game (a whole collection) is never deleted as one game.
    collection = tmp_path / "Juegos"
    (collection / "Zeta").mkdir(parents=True)
    storage.linked.link(6, "Coleccion", str(collection))
    storage.linked.link(7, "Zeta", str(collection / "Zeta"))
    assert not lib.batch("linked_delete", [6])[0]["ok"] and (collection / "Zeta").is_dir()


def test_a_linked_folder_game_moves_into_the_games_folder_with_the_standard_name(tmp_path):
    storage, lib = library(tmp_path)
    name = "Eta\u2122 Edici\u00f3n Especial"
    source = tmp_path / "outside" / name
    source.mkdir(parents=True)
    (source / "Eta.exe").write_bytes(b"x" * 100)
    storage.linked.link(8, name, str(source))
    result = lib.batch("linked_move", [8])[0]
    assert result["ok"], result
    assert not source.exists() and storage.linked.get(8) is None
    moved = [p.name for p in storage.root.iterdir() if p.name.startswith("8-")]
    assert moved == ["8-Eta_Edicion_Especial-ready"]


def test_a_move_that_would_not_fit_the_path_limit_leaves_the_game_linked(tmp_path, monkeypatch):
    storage, lib = library(tmp_path)
    source = tmp_path / "outside" / "Theta"
    source.mkdir(parents=True)
    (source / "Theta.exe").write_bytes(b"x")
    storage.linked.link(9, "Theta", str(source))
    monkeypatch.setattr("game_importer.importer.fits", lambda target, longest: False)
    result = lib.batch("linked_move", [9])[0]
    assert not result["ok"] and "caracteres" in result["error"]
    assert source.is_dir() and storage.linked.get(9)["path"] == str(source.resolve())


def test_the_games_folder_warning_flags_long_paths_and_special_characters():
    from game_paths import root_warning
    assert root_warning(r"C:\GA_Juegos") == ""
    assert "gamesRootLong" in root_warning(r"C:\Program Files\Game Access\juegos que instalo aca")
    assert "gamesRootSpecial" in root_warning("C:\\Juegos de Sebasti\u00e1n")
