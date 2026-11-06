"""Runtime port used by transports and extraction, independent of CLI globals."""
from dataclasses import dataclass, field
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
    # Run when the user cancels (not on errors): e.g. remove the game folder.
    cancel_hooks: list = field(default_factory=list)
    # How the bytes are being fetched, shown to the player: "measuring" (PLUS deciding), "torrent",
    # "accelerated" (the server's TorBox -> ViKiNG pieces) or "direct" (an HTTP link).
    set_route: Callable = lambda route: None
    # The steps shown to the player as a sequence (game_download_manager.steps.StepTracker); None in tests.
    steps: Any = None
    # Called by a transport as soon as it knows the download's size (total, bytes already on disk): raises
    # NoSpaceError when the download and its unpacking will not fit. Set by the pipeline; nothing is checked in tests.
    ensure_room: Callable = lambda total_bytes, on_disk_bytes=0: None
    set_room_check: Callable = lambda check: None

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
