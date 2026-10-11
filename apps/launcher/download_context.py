"""Runtime port used by transports and extraction, independent of CLI globals."""
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Any

@dataclass
class DownloadContext:
    launcher_dir: Path
    app_id: str
    cancelled: Any
    temp_files: list
    logger: Any
    emit_progress: Callable
    emit_error: Callable
    wait_if_paused: Callable
    find_portable_7z: Callable
    archive_member_names: Callable
    archive_enclosing_folder: Callable
    get_process: Callable
    set_process: Callable
    get_torrent: Callable
    set_torrent: Callable

    @property
    def active_subprocess(self):
        return self.get_process()

    @active_subprocess.setter
    def active_subprocess(self, process):
        self.set_process(process)

    @property
    def torrent_session(self):
        return self.get_torrent()

    @torrent_session.setter
    def torrent_session(self, session):
        self.set_torrent(session)
