"""Game Library Manager: governs the library as a whole and sits above the other managers.

    manager.py      inventory, states, play history, batch actions, connectors (execution, import, freezer)
    storage.py      the game folders on disk: '<appid>-<name>-<status>', registry, uninstall
    preferences.py  where games and temporary downloads live
    disk.py         folder sizes, free space, does a download plus its unpacking fit
"""
from .manager import GameLibraryManager
from .storage import DigitalGameStorage, split_folder_name

__all__ = ["GameLibraryManager", "DigitalGameStorage", "split_folder_name"]
