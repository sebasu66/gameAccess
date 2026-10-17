"""Game Execution Manager: everything that decides how a downloaded game gets to run.

    manager.py            analyze / prepare / repair state machine
    execution_profile.py  the editable profile (fix archive, executables to try, admin, setup mode)
    executables.py        finding the game's executable
    archives.py           what counts as an archive, a backup or a secondary volume
    extraction.py         unpacking archives found outside a download
    setup_installer.py    silent setup*.exe (GOG/Inno)
    fix_backup.py         the retained fix archive re-applied on every Play
    game_options.py       per-game launch options and language repair
    launch.py             starting the process (UAC, argument parsing, error-dialog detection)
"""
from .manager import GameExecutionManager, GameExecutionError
from .executables import find_candidates, rank_executable, has_game_executable

__all__ = ["GameExecutionManager", "GameExecutionError", "find_candidates", "rank_executable", "has_game_executable"]
