"""The local Steam client, read-only: where it is installed, the accounts it remembers, its library folders and the
games installed in them. Nothing here writes to Steam or reads passwords: `loginusers.vdf` only holds account names,
display names and the "remember me" flag."""
from __future__ import annotations
import os
from dataclasses import dataclass, asdict
from pathlib import Path
from . import vdf

STEAM_ID64_BASE = 76561197960265728
# Steam's own test app and the shared redistributables: never games.
IGNORED_APP_IDS = {480, 228980}
# appmanifest StateFlags: 4 = fully installed. Anything else is still downloading, updating or broken.
INSTALLED_FLAG = 4


def id32(steam_id64: str | int) -> int:
    return int(steam_id64) - STEAM_ID64_BASE


def id64(account_id: int) -> str:
    return str(int(account_id) + STEAM_ID64_BASE)


@dataclass
class SteamAccount:
    steam_id64: str
    account_name: str
    persona_name: str
    remembered: bool       # "Remember me" was ticked: Steam can sign in to it without a password
    most_recent: bool

    @property
    def account_id(self) -> int:
        return id32(self.steam_id64)

    def to_dict(self) -> dict:
        return {**asdict(self), "account_id": self.account_id}


@dataclass
class InstalledSteamGame:
    app_id: int
    name: str
    folder: str
    library: str
    owner_id64: str         # LastOwner: the account whose license the game was installed and last updated with
    size_bytes: int
    fully_installed: bool


def registry_steam_path() -> Path | None:
    if os.name != "nt":
        return None
    try:
        import winreg
        for hive, key, value in ((winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
                                 (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
                                 (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath")):
            try:
                with winreg.OpenKey(hive, key) as handle:
                    found = Path(str(winreg.QueryValueEx(handle, value)[0]))
                    if (found / "steam.exe").is_file():
                        return found
            except OSError:
                continue
    except ImportError:
        pass
    return None


def default_steam_paths() -> list[Path]:
    return [Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Steam",
            Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Steam", Path(r"C:\Steam")]


def find_steam() -> Path | None:
    """The Steam client folder: the one the registry names, else the usual install folders."""
    found = registry_steam_path()
    if found:
        return found
    return next((p for p in default_steam_paths() if (p / "steam.exe").is_file()), None)


def read_accounts(steam_root: Path) -> list[SteamAccount]:
    users = vdf.child(vdf.load(Path(steam_root) / "config" / "loginusers.vdf"), "users") or {}
    accounts = []
    for steam_id, data in users.items():
        if not (isinstance(data, dict) and str(steam_id).isdigit()):
            continue
        name = str(vdf.child(data, "AccountName") or "").strip()
        if not name:
            continue
        accounts.append(SteamAccount(steam_id64=str(steam_id), account_name=name,
                                     persona_name=str(vdf.child(data, "PersonaName") or name),
                                     remembered=str(vdf.child(data, "RememberPassword") or "0") == "1",
                                     most_recent=str(vdf.child(data, "MostRecent") or "0") == "1"))
    return accounts


def read_libraries(steam_root: Path) -> list[Path]:
    """Every library folder (the client's own first), as `<library>/steamapps`, without duplicates."""
    root = Path(steam_root)
    libraries = [root / "steamapps"]
    data = vdf.child(vdf.load(root / "steamapps" / "libraryfolders.vdf"), "libraryfolders") or {}
    for key, entry in data.items():
        if not str(key).isdigit():
            continue            # "contentstatsid", "TimeNextStatsReport"...
        path = vdf.child(entry, "path") if isinstance(entry, dict) else entry   # old format: "1" "D:\\Games"
        if isinstance(path, str) and path.strip():
            libraries.append(Path(path) / "steamapps")
    seen, unique = set(), []
    for library in libraries:
        key = os.path.normcase(os.path.normpath(str(library)))
        if key not in seen:
            seen.add(key)
            unique.append(library)
    return unique


def read_manifest(path: Path) -> InstalledSteamGame | None:
    state = vdf.child(vdf.load(path), "AppState")
    if not isinstance(state, dict):
        return None
    app_id = str(vdf.child(state, "appid") or "")
    installdir = str(vdf.child(state, "installdir") or "")
    if not app_id.isdigit() or not installdir or int(app_id) in IGNORED_APP_IDS:
        return None
    try:
        flags = int(vdf.child(state, "StateFlags") or 0)
        size = int(vdf.child(state, "SizeOnDisk") or 0)
    except ValueError:
        flags, size = 0, 0
    library = path.parent
    return InstalledSteamGame(app_id=int(app_id), name=str(vdf.child(state, "name") or installdir),
                              folder=str(library / "common" / installdir), library=str(library.parent),
                              owner_id64=str(vdf.child(state, "LastOwner") or ""), size_bytes=size,
                              fully_installed=bool(flags & INSTALLED_FLAG))


def installed_games(libraries: list[Path]) -> list[InstalledSteamGame]:
    found: dict[int, InstalledSteamGame] = {}
    for library in libraries:
        try:
            manifests = sorted(Path(library).glob("appmanifest_*.acf"))
        except OSError:
            continue
        for manifest in manifests:
            game = read_manifest(manifest)
            if game and game.app_id not in found:
                found[game.app_id] = game
    return list(found.values())
