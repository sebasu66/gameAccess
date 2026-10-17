import os
import sys
import time
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_journal as journal
import game_importer.importer as importer_module
from game_library_manager import GameLibraryManager
from game_library_manager.storage import DigitalGameStorage


@pytest.fixture
def messy(tmp_path, monkeypatch):
    """The real mess: legacy names, an empty folder, a stray folder, a duplicating backup, a leftover download."""
    monkeypatch.setattr(importer_module, "OBSOLETE_BACKUP_BYTES", 500)
    storage = DigitalGameStorage(tmp_path)
    root = storage.root
    legacy = root / "7-Gamma"
    (legacy / "Gamma").mkdir(parents=True)
    (legacy / "Gamma" / "Gamma.exe").write_bytes(b"x" * 100)
    (legacy / "Gamma_backup.rar").write_bytes(b"d" * 800)      # the whole game, kept next to its unpacked copy
    (legacy / ".digital-backup.json").write_text("{}", encoding="utf-8")
    (root / "8-Delta").mkdir()
    (root / "Random Folder").mkdir()
    (root / "Random Folder" / "a.txt").write_text("x")
    transfer = storage.launcher / ".cache" / "digital_transfers" / "9-Epsilon"
    transfer.mkdir(parents=True)
    (transfer / "part.bin").write_bytes(b"e" * 300)
    return storage, GameLibraryManager(storage)


def test_scan_names_every_reason_a_folder_is_not_standard(messy):
    storage, lib = messy
    games = {g["name"]: g for g in lib.list_games()}
    gamma = games["Gamma"]
    codes = [issue["code"] for issue in gamma["issues"]]
    assert codes == ["no_status", "no_log", "obsolete_backup"] and not gamma["standard"]
    assert gamma["reclaimable_bytes"] == 800
    assert "Delta" not in games and not (storage.root / "8-Delta").exists()      # empty folders are removed on scan
    assert [i["code"] for i in games["Random Folder"]["issues"]] == ["bad_name"] and games["Random Folder"]["app_id"] is None
    summary = lib.summary()
    assert summary["nonstandard"] == 2 and summary["reclaimable_bytes"] == 800 and summary["transfers_bytes"] == 300
    assert [t["app_id"] for t in lib.transfers()] == [9]
    epsilon = games["Epsilon"]                                                    # an unfinished download is one row, not a second list
    assert epsilon["partial"] and epsilon["state"] == "partial" and epsilon["transfer_bytes"] == 300 and epsilon["standard"]
    assert summary["count"] == 2 and summary["partial_downloads"] == 1


def test_adopting_brings_a_folder_to_the_standard_and_starts_its_log(messy):
    storage, lib = messy
    result = lib.batch("adopt", [7])[0]
    assert result["ok"] and result["freed_bytes"] == 800
    folder = storage.folder(7, "Gamma")
    assert folder.name == "7-Gamma-ready" and not (folder / "Gamma_backup.rar").exists() and not (folder / ".digital-backup.json").exists()
    log = journal.read(folder).splitlines()
    assert "importado" in log[0] and any("limpieza" in line for line in log)
    again = {g["app_id"]: g for g in lib.list_games() if g["app_id"] == 7}[7]
    assert again["standard"] and again["state"] == "ready"


def test_empty_folders_and_empty_downloads_are_deleted_automatically_but_real_downloads_stay(messy):
    storage, lib = messy
    (storage.launcher / ".cache" / "digital_transfers" / "11-Empty Transfer").mkdir()
    lib.list_games()
    assert not (storage.root / "8-Delta").exists()
    assert not (storage.launcher / ".cache" / "digital_transfers" / "11-Empty Transfer").exists()
    assert (storage.launcher / ".cache" / "digital_transfers" / "9-Epsilon").is_dir()


def test_plan_lists_every_action_before_anything_runs_and_adopt_follows_it(messy):
    storage, lib = messy
    plan = lib.plan([7])[0]
    codes = [a["code"] for a in plan["actions"]]
    assert codes == ["create_log", "find_executable", "delete_source", "rename"] and plan["freed_bytes"] == 800
    assert any("Gamma_backup.rar" in a["label"] for a in plan["actions"]) and any(a["label"].endswith("7-Gamma-ready") for a in plan["actions"])
    assert (storage.root / "7-Gamma" / "Gamma_backup.rar").exists()               # planning changes nothing
    assert lib.batch("adopt", [7])[0]["freed_bytes"] == 800


def test_the_delete_sources_setting_keeps_everything_when_off(messy):
    storage, lib = messy
    storage.preferences.save({"delete_download_sources": False})
    games = {g["name"]: g for g in lib.list_games()}
    assert "obsolete_backup" not in [i["code"] for i in games["Gamma"]["issues"]]
    plan = lib.plan([7])[0]
    assert "delete_source" not in [a["code"] for a in plan["actions"]] and plan["freed_bytes"] == 0
    result = lib.batch("adopt", [7])[0]
    assert result["ok"] and result["freed_bytes"] == 0
    assert (storage.folder(7, "Gamma") / "Gamma_backup.rar").exists()


def test_setting_defaults_to_on_and_the_declared_fix_is_listed_as_kept(messy):
    storage, lib = messy
    assert storage.preferences.load()["delete_download_sources"] is True
    from game_execution_manager.execution_profile import save_profile
    save_profile(storage.launcher, 7, {"decompressFile": "Gamma_backup.rar", "decompressEachRun": True})
    plan = lib.plan([7])[0]
    assert [a["code"] for a in plan["actions"]].count("keep") == 1 and "delete_source" not in [a["code"] for a in plan["actions"]]


def test_usage_counts_launches_per_day_and_month(messy):
    storage, lib = messy
    folder = storage.folder(7, "Gamma")
    (folder / journal.JOURNAL_FILE).write_text("2026-10-01 10:00:00 | play | lanzado: a\n2026-10-01 12:00:00 | play | lanzado: a\n2026-11-02 09:00:00 | play | lanzado: a\n2026-11-02 09:01:00 | analisis | x\n", encoding="utf-8")
    usage = lib.usage()
    assert usage["by_day"] == {"2026-10-01": 2, "2026-11-02": 1} and usage["by_month"] == {"2026-10": 2, "2026-11": 1}


def test_a_declared_fix_archive_is_never_treated_as_a_duplicate(messy):
    storage, lib = messy
    from game_execution_manager.execution_profile import save_profile
    save_profile(storage.launcher, 7, {"decompressFile": "Gamma_backup.rar", "decompressEachRun": True})
    games = {g["name"]: g for g in lib.list_games()}
    assert "obsolete_backup" not in [i["code"] for i in games["Gamma"]["issues"]]


def test_discarding_a_leftover_download_frees_the_temporary_folder(messy):
    storage, lib = messy
    assert lib.batch("discard_transfer", [9])[0]["ok"] and lib.transfers() == []
    live = storage.launcher / ".cache" / "digital_downloads"
    live.mkdir(parents=True, exist_ok=True)
    (storage.launcher / ".cache" / "digital_transfers" / "10-Zeta").mkdir()
    (live / "10.json").write_text("{}")
    assert "en curso" in lib.batch("discard_transfer", [10])[0]["error"]


def test_manager_actions_and_errors_reach_the_general_log_and_it_stays_bounded(messy, tmp_path):
    import app_log
    storage, lib = messy
    logs = tmp_path / "logs"
    app_log.configure(directory=logs, max_bytes=4000)
    try:
        lib.list_games()
        lib.batch("adopt", [7])
        lib.batch("discard_transfer", [12345])           # not in the library: an error line
        text = (logs / "execution.log").read_text(encoding="utf-8")
        assert "Scan:" in text and "adopted as 7-Gamma-ready" in text and "Batch adopt" in text
        for _ in range(200):
            lib.log.info("filler line to push the log past its limit " * 3)
        sizes = [p.stat().st_size for p in logs.glob("execution.log*")]
        assert len(sizes) <= 2 and max(sizes) <= 4000 + 400
    finally:
        app_log.configure()
