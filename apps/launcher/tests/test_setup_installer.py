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
