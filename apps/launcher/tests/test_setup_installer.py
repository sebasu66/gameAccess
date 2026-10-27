import logging
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_execution_manager.setup_installer import find_setup, needs_setup, install_if_needed, build_command

LOG = logging.getLogger("setup-test")

def gog_folder(tmp_path):
    folder = tmp_path / "Trail_out_win_gog"
    folder.mkdir()
    (folder / "setup_trail_out_1.1_(87450).exe").write_bytes(b"setup")
    (folder / "setup_trail_out_1.1_(87450)-1.bin").write_bytes(b"data")
    return folder

def fake_runner(code=0, creates="TrailOut.exe"):
    calls = []
    def run(command, as_admin):
        calls.append((command, as_admin))
        target = Path(next(a for a in command if a.startswith("/DIR="))[5:])
        if creates:
            (target / creates).write_bytes(b"game")
        return code
    run.calls = calls
    return run

def test_finds_setup_and_ignores_uninstallers(tmp_path):
    folder = gog_folder(tmp_path)
    (folder / "unins000.exe").write_bytes(b"x")
    assert find_setup(folder).name.startswith("setup_trail_out")

def test_automatic_only_when_there_is_no_game_exe(tmp_path):
    folder = gog_folder(tmp_path)
    assert needs_setup(folder, {}) is not None
    (folder / "Game.exe").write_bytes(b"g")
    assert needs_setup(folder, {}) is None
    assert needs_setup(folder, {"runSetup": True}) is not None
    assert needs_setup(folder, {"runSetup": False}) is None

def test_silent_install_into_installed_folder_then_cleanup(tmp_path):
    folder = gog_folder(tmp_path)
    runner = fake_runner()
    assert install_if_needed(folder, {"runAsAdmin": True}, LOG, runner=runner)
    command, as_admin = runner.calls[0]
    assert as_admin and "/VERYSILENT" in command and command[-1] == f"/DIR={folder.resolve() / 'Game'}"
    assert (folder / "Game" / "TrailOut.exe").is_file()
    assert not list(folder.glob("setup_*"))

def test_failure_keeps_installer_and_reports_it(tmp_path):
    folder = gog_folder(tmp_path)
    with pytest.raises(RuntimeError, match="código 5"):
        install_if_needed(folder, {}, LOG, runner=fake_runner(code=5))
    other = gog_folder(tmp_path / "second") if (tmp_path / "second").mkdir() is None else None
    with pytest.raises(RuntimeError, match="ejecutable"):
        install_if_needed(other, {}, LOG, runner=fake_runner(creates=None))
    assert list(folder.glob("setup_*.exe"))

def test_the_installer_keeps_a_log_and_a_failure_says_why(tmp_path):
    folder = gog_folder(tmp_path)
    def failing(command, as_admin):
        log = Path(next(a for a in command if a.startswith("/LOG="))[5:])
        log.write_text("2026-10-27 18:59:00.100   Extracting file.\n2026-10-27 18:59:02.200   Exception message:\n"
                       "2026-10-27 18:59:02.200   Error creating file (code 3).\n", encoding="utf-8")
        return 4
    with pytest.raises(RuntimeError) as failure:
        install_if_needed(folder, {}, LOG, runner=failing)
    text = str(failure.value)
    assert "error fatal durante la instalación" in text and "Error creating file (code 3)." in text
    assert (folder / "setup-install-log.txt").is_file()


def test_a_deep_install_folder_is_named_as_the_likely_cause(tmp_path, monkeypatch):
    import game_execution_manager.setup_installer as setup_installer
    folder = gog_folder(tmp_path)
    monkeypatch.setattr(setup_installer, "LONG_TARGET", 5)
    with pytest.raises(RuntimeError, match="causa probable"):
        install_if_needed(folder, {}, LOG, runner=fake_runner(code=4, creates=None))
