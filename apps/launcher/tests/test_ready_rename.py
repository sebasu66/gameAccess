"""The last step of an install, the "-ready" rename: tried again while a file is held, and a download that never gets
there fails instead of saying "ready to play" over a folder the library does not take as installed."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from launcher_copy import copy_launcher, game_zip, run_downloader, serve  # noqa: E402


def blocked_ready(times: int) -> str:
    """Python for the downloader's process: the first `times` renames to "ready" fail as a held file makes them."""
    return (
        "import game_download_manager.pipeline as pipeline\n"
        "pipeline.READY_RENAME_WAIT_SECONDS = 0\n"
        "from game_library_manager.storage import DigitalGameStorage\n"
        "_real = DigitalGameStorage.set_status\n"
        f"_left = [{times}]\n"
        "def _held(self, app_id, name, status):\n"
        "    if status == 'ready' and _left[0] > 0:\n"
        "        _left[0] -= 1\n"
        "        raise PermissionError(32, 'El proceso no tiene acceso al archivo porque está siendo utilizado por otro proceso')\n"
        "    return _real(self, app_id, name, status)\n"
        "DigitalGameStorage.set_status = _held\n"
    )


def download(tmp_path, times):
    launcher = copy_launcher(tmp_path)
    game_zip(tmp_path / "source")
    with serve(tmp_path / "source") as url:
        result = run_downloader(launcher, 7, "Fixture", f"{url}/fixture.zip", prelude=blocked_ready(times))
    status = json.loads((launcher / ".cache" / "digital_downloads" / "7.json").read_text(encoding="utf-8"))
    folders = [p.name for p in (launcher / "games").iterdir()]
    return result, status, folders


def test_a_rename_held_for_a_moment_is_tried_again_and_the_game_is_ready(tmp_path):
    result, status, folders = download(tmp_path, times=2)
    assert result.returncode == 0, result.stderr[-2000:]
    assert status["phase"] == "completed"
    assert folders == ["7-Fixture-ready"]


def test_a_rename_that_never_goes_fails_the_download_instead_of_saying_ready(tmp_path):
    result, status, folders = download(tmp_path, times=99)
    assert result.returncode != 0
    assert status["phase"] == "error"
    assert "dlErrReadyRename" in (status.get("error") or status.get("statusText") or "")
    assert folders and not any(name.endswith("-ready") for name in folders)
