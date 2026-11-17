"""A copy of the launcher in a temporary folder and a local web server, to run the real downloader end to end.

The copied launcher keeps its data (games root, `.cache`, `logs`) inside that folder, so nothing touches the PC's
library. Shared by test_ready_rename.py and the on-demand lifecycle tests (test_lifecycle.py)."""
import functools
import os
import http.server
import shutil
import subprocess
import sys
import threading
import zipfile
from contextlib import contextmanager
from pathlib import Path

LAUNCHER = Path(__file__).resolve().parents[1]


def copy_launcher(target: Path) -> Path:
    for file in LAUNCHER.glob("*.py"):
        shutil.copyfile(file, target / file.name)
    for package in [d for d in LAUNCHER.iterdir() if d.is_dir() and (d / "__init__.py").is_file() and d.name != "tests"]:
        shutil.copytree(package, target / package.name, ignore=shutil.ignore_patterns("__pycache__"))
    return target


def game_zip(folder: Path, name: str = "Fixture") -> Path:
    """A small game: its executable and level files that compress well (so freezing saves space)."""
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder / "fixture.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr(f"{name}.exe", b"MZ" + b"\0" * 4000)
        for i in range(6):
            zipped.writestr(f"data/levels/level{i}.txt", ("level %d: the quick brown fox jumps over the lazy dog\n" % i) * 20000)
    return archive


@contextmanager
def serve(folder: Path):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(folder)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()


def run_downloader(launcher: Path, app_id: int, name: str, source: str, prelude: str = "", timeout: int = 120):
    """The downloader as the app starts it; `prelude` is Python run first in the same process (to patch something)."""
    script = (
        "import sys\n"
        f"sys.path.insert(0, {str(launcher)!r})\n"
        f"{prelude}\n"
        "from game_download_manager.worker import main\n"
        f"sys.argv = ['digital_downloader.py', '--app-id', '{app_id}', '--name', {name!r}, '--source', {source!r}]\n"
        "sys.exit(main())\n"
    )
    # Without GAMEACCESS_LAUNCHER_DATA the copy keeps games and data in its own folder (preferences.py), never the PC's.
    env = {key: value for key, value in os.environ.items() if key != "GAMEACCESS_LAUNCHER_DATA"}
    return subprocess.run([sys.executable, "-c", script], cwd=launcher, env=env, capture_output=True, text=True, timeout=timeout)
