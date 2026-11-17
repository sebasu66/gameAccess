"""What a game needs around it to run: Steam, a store launcher (Epic, Ubisoft Connect, EA app, Rockstar, Paradox,
Battle.net) and its anti-cheat. It is part of the game's execution profile (`requires`): found from the game's own files
the first time it is played, added to by a plugin, the server's fix or the player, and used by Play, the launch dialog's
checks and the automatic fix, so none of them has to look at the files again. Signing in stays with the player: Game
Access starts the launcher and brings it to the front, it never types a password."""
from __future__ import annotations
from pathlib import Path

from . import anticheat, store_launchers

STEAM_FILES = ("steam_api.dll", "steam_api64.dll", "OnlineFix.ini", "OnlineFix64.dll")


def clean(value) -> dict | None:
    """Only known names survive; nothing at all gives None."""
    if not isinstance(value, dict):
        return None
    pick = lambda key, known: sorted({item for item in value.get(key, []) if item in known}) if isinstance(value.get(key), list) else []  # noqa: E731
    cleaned = {"steam": value.get("steam") is True, "launchers": pick("launchers", store_launchers.KNOWN), "anticheat": pick("anticheat", anticheat.ANTICHEATS)}
    return cleaned if (cleaned["steam"] or cleaned["launchers"] or cleaned["anticheat"]) else None


def detect(folder: Path) -> dict:
    """What the game's files show it needs ({steam, launchers, anticheat}; empty lists when nothing)."""
    root = Path(folder)
    steam = root.is_dir() and any((root / name).is_file() for name in STEAM_FILES)
    return {"steam": bool(steam), "launchers": store_launchers.needed_by(root), "anticheat": anticheat.shipped_with(root)}


def merge(*sources: dict | None) -> dict:
    """The union of what each source says (a plugin's, the player's, what was detected)."""
    merged = {"steam": False, "launchers": [], "anticheat": []}
    for source in sources:
        source = clean(source)
        if source:
            merged["steam"] = merged["steam"] or source["steam"]
            merged["launchers"] = sorted(set(merged["launchers"]) | set(source["launchers"]))
            merged["anticheat"] = sorted(set(merged["anticheat"]) | set(source["anticheat"]))
    return merged
