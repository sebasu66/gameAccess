"""Leaves a free Steam game downloaded by DepotDownloader in the player's Steam library, for Steam to adopt.

The files go to `<library>/steamapps/common/<installdir>`, Steam's own place for the game; then an
`appmanifest_<appid>.acf` says the game is there and needs an update (StateFlags 1026). On its next look Steam
"discovers existing files": it checks them against its manifests and downloads only what is missing or different,
so Steam stays the owner of the install, its updates and its launch. Game Access writes nothing else of Steam's.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

# Update required (2) + update started (1024): Steam checks the files it finds instead of downloading them again.
HANDOFF_STATE_FLAGS = 1026
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_installdir(name: str) -> str:
    """A folder name from the game's name, when Steam's appinfo does not give one."""
    cleaned = _UNSAFE.sub("", name).strip().rstrip(".")
    return cleaned or "Game"


def manifest_path(library: Path, app_id: int) -> Path:
    return library / "steamapps" / f"appmanifest_{app_id}.acf"


def game_dir(library: Path, installdir: str) -> Path:
    return library / "steamapps" / "common" / installdir


def is_installed(library: Path, app_id: int) -> bool:
    return manifest_path(library, app_id).is_file()


def _vdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def write_manifest(library: Path, app_id: int, name: str, installdir: str, size_on_disk: int, owner_id64: str = "") -> Path:
    """The appmanifest Steam reads to adopt the game. An existing one (Steam's own) is never overwritten. `owner_id64`
    is the account that downloaded it: Play switches Steam to it, as for any game that account installed."""
    path = manifest_path(library, app_id)
    if path.exists():
        return path
    body = "\n".join([
        '"AppState"', "{",
        f'\t"appid"\t\t"{app_id}"',
        '\t"Universe"\t\t"1"',
        f'\t"name"\t\t"{_vdf_text(name)}"',
        f'\t"StateFlags"\t\t"{HANDOFF_STATE_FLAGS}"',
        f'\t"installdir"\t\t"{_vdf_text(installdir)}"',
        f'\t"SizeOnDisk"\t\t"{max(0, int(size_on_disk))}"',
        *([f'\t"LastOwner"\t\t"{owner_id64}"'] if str(owner_id64).isdigit() else []),
        '\t"AutoUpdateBehavior"\t\t"0"',
        "}", ""])
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".acf.part")
    partial.write_text(body, encoding="utf-8")
    partial.replace(path)
    return path


def finish(target: Path) -> int:
    """Removes DepotDownloader's own bookkeeping from the game folder; returns the size Steam will find."""
    shutil.rmtree(target / ".DepotDownloader", ignore_errors=True)
    return sum(item.stat().st_size for item in target.rglob("*") if item.is_file())


def install_url(app_id: int) -> str:
    """Steam's own install: the fallback when DepotDownloader cannot bring the game, and the hand-over after it did."""
    return f"steam://install/{int(app_id)}"
