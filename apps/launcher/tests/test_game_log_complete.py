"""The game's log says everything (Seba, 2026-11-02): each verification and its verdict, every error, each change of
its options, for games of the library and linked games alike."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import game_journal as journal
import digital_process_runner as runner_module
from digital_process_runner import DigitalProcessRunner, verify_line
from game_library_manager import linked as linked_module
from game_library_manager.storage import DigitalGameStorage


def linked_runner(tmp_path):
    storage = DigitalGameStorage(tmp_path / "library")
    game = tmp_path / "Darkest Dungeon II"
    game.mkdir()
    (game / "Darkest Dungeon II.exe").write_bytes(b"MZ")
    storage.linked.link(1940340, "Darkest Dungeon II", str(game), "folder", f"{game}\\{game}\\Darkest Dungeon II.exe")
    return DigitalProcessRunner(storage), storage, game


def log_of(storage, app_id=1940340):
    return journal.read(storage.linked.log_dir(app_id))


def test_a_doubled_executable_path_from_the_scan_is_kept_whole():
    assert linked_module.whole_path("C:\\games\\X\\C:\\games\\X\\x.exe") == "C:\\games\\X\\x.exe"
    assert linked_module.whole_path("C:\\games\\X\\x.exe") == "C:\\games\\X\\x.exe"
    assert linked_module.whole_path("") == ""


def test_a_verification_and_its_verdict_go_to_the_log(tmp_path, monkeypatch):
    instance, storage, _ = linked_runner(tmp_path)
    monkeypatch.setattr(instance, "verify_run", lambda *a, **k: {"ok": True, "check": {"state": "cantRun", "detail": "[WinError 740] requiere elevación", "seconds": 0.0}})
    instance.run("verify-run", 1940340, "Darkest Dungeon II", "{}")
    lines = log_of(storage).splitlines()
    assert lines[-2].endswith("verificación | empieza")
    assert lines[-1].endswith("verificación | no corre: [WinError 740] requiere elevación")


def test_a_skipped_verification_says_why():
    assert verify_line({"ok": True, "skipped": "running"}) == "no se probó: el juego ya está abierto"
    assert verify_line({"ok": True, "check": {"state": "checked", "detail": "stayed open 10 s", "seconds": 12.0}}) == "corre: stayed open 10 s (12.0 s)"


def test_a_linked_play_that_fails_writes_its_error(tmp_path, monkeypatch):
    instance, storage, _ = linked_runner(tmp_path)

    def refused(*args, **kwargs):
        error = OSError("no")
        error.winerror = 2
        raise error
    monkeypatch.setattr(linked_module.subprocess, "Popen", refused)
    result = instance.run("play", 1940340, "Darkest Dungeon II")
    assert not result["ok"]
    assert "play | error:" in log_of(storage)


def test_a_game_that_asks_for_administrator_is_launched_as_administrator(tmp_path, monkeypatch):
    instance, storage, _ = linked_runner(tmp_path)

    def elevation(*args, **kwargs):
        error = OSError("La operación solicitada requiere elevación")
        error.winerror = 740
        raise error
    import game_execution_manager.launch as launch
    launched = []
    monkeypatch.setattr(linked_module.subprocess, "Popen", elevation)
    monkeypatch.setattr(launch, "launch_as_administrator", lambda exe, args, cwd: launched.append(Path(exe).name) or 77)
    result = instance.run("play", 1940340, "Darkest Dungeon II")
    assert result["ok"] and result["pid"] == 77 and result["administrator"]
    assert launched == ["Darkest Dungeon II.exe"]
    assert "lanzado como administrador: Darkest Dungeon II.exe (pid 77)" in log_of(storage)


def test_saving_the_options_of_a_library_game_writes_them(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    folder = storage.register(60, "Options fixture")
    instance = DigitalProcessRunner(storage)
    result = instance.run("save-game-options", 60, "Options fixture", '{"language": "keep", "administrator": true}')
    assert result["ok"]
    line = journal.read(storage.folder(60, "Options fixture")).splitlines()[-1]
    assert "opciones | " in line and "idioma: sin adaptar" in line and "administrador: sí" in line
