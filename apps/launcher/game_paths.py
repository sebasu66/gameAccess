"""Paths games run from. Windows (MAX_PATH, 260 characters) and many older games fail when the path to their files is
long or holds unusual characters (accents, symbols): a game that would not start was fixed only by renaming its folder.
So the games folder should be short and plain (C:\\GA_Juegos), and nothing moves a game where its files would not fit."""
from __future__ import annotations
import re
from pathlib import Path

# Longest games folder that leaves room for a game's own deep folders under MAX_PATH.
SAFE_ROOT_LENGTH = 40
MAX_PATH = 259
_PLAIN = re.compile(r"^[A-Za-z0-9 _.\-:\\/]+$")


def root_warning(path: str) -> str:
    """Why this games folder may keep games from running, as a key of the app's translations (game_download_manager
    .ui_text), or "" when it is short and plain."""
    from game_download_manager.ui_text import ui
    text = str(path).strip()
    long, special = len(text) > SAFE_ROOT_LENGTH, not _PLAIN.match(text)
    if long and special:
        return ui("gamesRootLongSpecial", length=len(text), limit=SAFE_ROOT_LENGTH)
    if long:
        return ui("gamesRootLong", length=len(text), limit=SAFE_ROOT_LENGTH)
    return ui("gamesRootSpecial") if special else ""


def longest_inside(folder: Path) -> int:
    """Length of the longest path of a file under `folder`, counted from the folder (without it)."""
    base = len(str(folder)) + 1
    return max((len(str(item)) - base for item in Path(folder).rglob("*")), default=0)


def fits(target: Path, longest: int) -> bool:
    """Whether a game whose deepest file is `longest` characters inside it fits under MAX_PATH at `target`."""
    return len(str(target)) + 1 + longest <= MAX_PATH
