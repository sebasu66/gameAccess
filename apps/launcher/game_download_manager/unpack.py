"""Drives the download worker's extractor quietly, for archives found outside a download.

The Download Manager owns extraction (7-Zip, profile passwords, multipart volumes). The Execution
Manager never imports this: callers inject `extractor_for` / `restorer_for` into it."""
from __future__ import annotations
import contextlib
import io
from pathlib import Path


def extract_archive(launcher, app_id, archive, destination, *, delete_archive: bool, retain_backup: bool) -> None:
    from game_download_manager import worker as worker
    worker.LAUNCHER_DIR = Path(launcher)
    worker.g_app_id = str(app_id)
    worker.g_cancelled.clear()
    # The native runner's stdout must remain exactly one JSON result.
    original_emit = worker.emit_json
    try:
        worker.emit_json = lambda *_args, **_kwargs: None
        with contextlib.redirect_stdout(io.StringIO()):
            worker.extract_archives_in_path(str(archive), str(destination), delete_archive=delete_archive, retain_backup=retain_backup)
    finally:
        worker.emit_json = original_emit


def extractor_for(launcher, app_id):
    """The `extractor(folder, archive)` callable the Game Execution Manager expects."""
    return lambda folder, archive: extract_archive(launcher, app_id, archive, folder, delete_archive=True, retain_backup=True)


def restorer_for(launcher, app_id):
    """The `extract(archive, destination)` callable that re-applies a retained fix without touching it."""
    return lambda archive, destination: extract_archive(launcher, app_id, archive, destination, delete_archive=False, retain_backup=False)
