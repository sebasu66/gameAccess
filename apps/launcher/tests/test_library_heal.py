import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_library_manager.storage import DigitalGameStorage
from game_library_manager import GameLibraryManager
from game_library_manager.freezer import DEEP_ARCHIVE, GameFreezer
import app_log


def test_refresh_makes_a_game_unpacked_by_hand_ready_again(tmp_path):
    # Seba, 2026-10-30: a game of the library was broken; unpacked by hand, "Refresh" did nothing.
    storage = DigitalGameStorage(tmp_path)
    storage.register(5, "Alpha")
    folder = storage.set_status(5, "Alpha", "ERROR")
    (folder / "bin").mkdir()
    (folder / "bin" / "Alpha.exe").write_bytes(b"game")
    library = GameLibraryManager(storage)
    assert library.heal() == ["Alpha"]
    assert storage.folder(5, "Alpha").name.endswith("-ready")
    assert storage.status(5, "Alpha")["installed"]
    # Ready already: nothing to do the next time.
    assert library.heal() == []


def test_refresh_leaves_downloads_and_empty_folders_alone(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    storage.register(6, "Beta")
    storage.set_status(6, "Beta", "downloading")
    storage.register(7, "Gamma")
    storage.set_status(7, "Gamma", "ERROR")   # nothing runnable inside
    assert GameLibraryManager(storage).heal() == []
    assert storage.folder(6, "Beta").name.endswith("-downloading")


def test_a_deep_freeze_archive_without_its_record_is_a_deep_freeze(tmp_path):
    # Another copy of Game Access froze it: this one has no record, only the archive in the folder.
    storage = DigitalGameStorage(tmp_path)
    storage.register(8, "Delta")
    folder = storage.set_status(8, "Delta", "ready")
    (folder / DEEP_ARCHIVE).write_bytes(b"7z" * 100)
    freezer = GameFreezer(storage, app_log.manager_logger("test"))
    assert freezer.is_deep(8, "Delta")
    assert freezer.describe(8, folder)["frozen"] == "deep"
    # Refresh does not take it for a broken game.
    assert GameLibraryManager(storage).heal() == []
