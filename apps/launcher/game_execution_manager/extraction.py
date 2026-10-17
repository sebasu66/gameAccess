"""Drives the download worker's extractor quietly, for archives found outside a download.

Used to re-apply the fix before Play and to unpack leftovers when a game is repaired, so the
extraction rules (7-Zip, passwords from the profile, multipart volumes) live in one place."""
from __future__ import annotations
import contextlib
import io
from pathlib import Path


def extract_archive(launcher, app_id, archive, destination, *, delete_archive: bool, retain_backup: bool) -> None:
    import digital_downloader as worker
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
