"""Finds games already installed on the user's disks, to offer them for import. Read-only."""
from __future__ import annotations
import hashlib
import os
import re
import shutil
import time
import unicodedata
from pathlib import Path
import app_log
from .live import ScanCancelled, ScanReport

MIN_GAME_BYTES = 200 * 1024 ** 2
MAX_FILES = 60000            # per candidate: stop counting a huge tree rather than crawl it for minutes
MAX_SECONDS = 180
CONTAINER_NAMES = {"games", "game", "juegos", "juego", "library", "libreria", "steam games", "steamlibrary", "gog games",
                   "epic games", "xboxgames", "repacks"}
# Download folders hold archives and half-finished downloads, not installed games: they are never scanned.
DOWNLOAD_DIRS = {"descargas", "downloads", "download", "torrents", "incomplete"}
PARTIAL_DOWNLOAD = re.compile(r"\.(part|crdownload|!qb|!ut|bc!|aria2|partial)$", re.I)
PROGRAM_FILES = {"program files", "program files (x86)"}
# An installer, uninstaller or redistributable is not the game: a folder whose only .exe is one of these is skipped.
IGNORED_EXE = re.compile(r"^(unins|install|vcredist|vc_redist|dxsetup|dotnet|crashreport|crashhandler|unitycrash|ue4prereq|oalinst|launcher_updater)|setup|installer|redist|crash|helper|updater|uninstall", re.I)
# Programs and Steam support folders that look like games (big, with an .exe) but are not. Compared without spaces,
# punctuation, accents or a trailing version number ("Blender 4.2" is "blender").
IGNORED_SOFTWARE = {"blender", "blenderfoundation", "shapelab", "foundryvtt", "easypose", "nucleus", "corefx", "openbrush",
                    "blocks", "ubisoftconnect", "ubisoftconnectservices", "ubisoftgamelauncher", "steamworkscommonredistributables",
                    "steamworksshared", "spacewar"}
IGNORED_APP_IDS = {480, 228980}      # Spacewar (Steam's test app), Steamworks Common Redistributables
# Steam's own app type (appinfo.vdf "common/type"): only games and demos are offered; tools, applications, configs,
# soundtracks and videos are skipped. An AppID the local Steam does not know is kept.
GAME_APP_TYPES = {"game", "demo", "beta", ""}
TECH_DIRS = {"bin", "bin32", "bin64", "binaries", "win32", "win64", "x86", "x64", "game", "release", "shipping", "windows", "retail", "system", "engine"}
IGNORED_DIRS = {"_commonredist", "redist", "__macosx", "$recycle.bin", "system volume information", "windows"}
# Files that Steam emulators and fixes leave in the game folder, with the game's real AppID. Earlier ones win:
# OnlineFix.ini also carries FakeAppId (usually 480, Spacewar), so only RealAppId counts.
APP_ID_FILES = {"onlinefix.ini": re.compile(r"^\s*RealAppId\s*=\s*(\d+)", re.I | re.M),
                "steam_emu.ini": re.compile(r"^\s*AppId\s*=\s*(\d+)", re.I | re.M),
                "coldclientloader.ini": re.compile(r"^\s*AppId\s*=\s*(\d+)", re.I | re.M),
                "steam_appid.txt": re.compile(r"^\s*(\d+)\s*$", re.M)}
FAKE_APP_IDS = {0, 480}
MAX_APP_ID_FILE_BYTES = 64 * 1024
APP_ID_FILE_DEPTH = 5        # Unreal games keep them in <Game>\<Project>\Binaries\Win64


def _plain(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def _compact(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", re.sub(r"[\s._-]*v?\d[\d.]*$", "", _plain(text).strip()))


def is_ignored_software(*names: str) -> bool:
    """A program or support folder (Blender, Foundry VTT, Steamworks Common Redistributables...), not a game."""
    return any(name and _compact(name) in IGNORED_SOFTWARE for name in names)


def steam_app_info(app_ids: set[int], clients: list[Path]) -> dict[int, dict]:
    """Steam's record ({name, type, ...}) for each AppID, from the first local Steam client whose appcache/appinfo.vdf
    can be read."""
    from steam_appinfo import read_local_app_catalog
    for client in clients:
        appinfo = Path(client) / "appcache" / "appinfo.vdf"
        if not _is_file(appinfo):
            continue
        try:
            found = read_local_app_catalog(appinfo, set(app_ids))
        except (OSError, ValueError):
            continue
        return found
    return {}


def _is_dir(path: Path) -> bool:
    """Like Path.is_dir, but a folder Windows will not let us read (WpSystem, protected app folders) is just skipped:
    one unreadable folder must never stop the scan of the whole disk."""
    try:
        return path.is_dir()
    except OSError:
        return False


def _is_file(path: Path) -> bool:
    try:
        return path.is_file()
    except OSError:
        return False


def is_steam_path(path) -> bool:
    """Inside a Steam library ('.../steamapps/...'): Steam owns that structure, so it must never be moved or renamed."""
    return any(part.lower() == "steamapps" for part in Path(path).parts)


def _declared_app_id(path: str, name: str) -> int | None:
    """The AppID written in an emulator/fix file (`AppId=`, `RealAppId=`, or the bare number of steam_appid.txt)."""
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_APP_ID_FILE_BYTES)
    except OSError:
        return None
    text = raw.decode("utf-16", errors="replace") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", errors="replace")
    match = APP_ID_FILES[name].search(text)
    app_id = int(match.group(1)) if match else 0
    return None if app_id in FAKE_APP_IDS else app_id


def _acf(text: str, key: str) -> str:
    match = re.search(rf'"{key}"\s+"([^"]*)"', text, re.I)
    return match.group(1) if match else ""


class GameScanner:
    def __init__(self, exclude=(), known_app_ids=(), progress=lambda text: None, report: ScanReport | None = None):
        self.exclude = [Path(p).resolve() for p in exclude]
        self.known = {int(i) for i in known_app_ids}
        self.progress = progress
        # The folder being read and each game found, for the app to show live; also where "Stop" is asked (live.py).
        self.report = report or ScanReport()
        self.log = app_log.manager_logger("importer")
        self._deadline = 0.0

    # -- disks ---------------------------------------------------------------------------------
    @staticmethod
    def drives() -> list[dict]:
        """Fixed disks the user can choose to scan: [{path, label, total_bytes, free_bytes}]."""
        roots = []
        if os.name == "nt":
            import ctypes
            mask = ctypes.windll.kernel32.GetLogicalDrives()
            for index in range(26):
                if mask & (1 << index):
                    path = f"{chr(65 + index)}:\\"
                    if ctypes.windll.kernel32.GetDriveTypeW(path) == 3:      # DRIVE_FIXED
                        roots.append(path)
        else:
            roots.append("/")
        found = []
        for root in roots:
            try:
                usage = shutil.disk_usage(root)
                found.append({"path": root, "label": root.rstrip("\\"), "total_bytes": usage.total, "free_bytes": usage.free})
            except OSError:
                continue
        return found

    # -- scan ------------------------------------------------------------------------------------
    def scan(self, drives: list[str], folders: list[str] = ()) -> list[dict]:
        """Candidate games on the chosen disks, biggest first, plus everything inside the folders the player added
        (each game folder in them, or the folder itself when it is one game). Steam games carry their AppID."""
        self._deadline = time.time() + MAX_SECONDS
        found: dict[str, dict] = {}

        def keep(game: dict) -> None:
            if game["path"] in found:
                return
            found[game["path"]] = game
            if not self._excluded(Path(game["path"])) and game.get("app_id") not in self.known:
                self.report.found(game)

        cancelled = False
        try:
            for folder in folders:
                for game in self._scan_folder(Path(folder)):
                    keep(game)
            for drive in drives:
                root = Path(drive)
                if not _is_dir(root):
                    continue
                self.progress(f"Buscando en {drive}")
                self.report.folder(root)
                try:
                    for steamapps in self._steam_libraries(root):
                        self.report.folder(steamapps)
                        for game in self._steam_games(steamapps):
                            keep(game)
                    for container, source in self._containers(root):
                        if source == "steam":
                            continue            # the Steam client folder itself holds no loose games
                        self.progress(f"Revisando {container}")
                        for sub in self._subdirs(container):
                            for game in self._collect(sub, source, 1):
                                keep(game)
                except OSError as error:
                    self.log.warning("Scan of %s interrupted: %s", drive, error)
        except ScanCancelled:
            # Stopped by the player: what was found so far is still offered.
            cancelled = True
            self.log.info("Game scan stopped by the player after %s folders", self.report.state["folders"])
        games = [g for g in found.values() if not self._excluded(Path(g["path"])) and not (g.get("app_id") in self.known)]
        games = self._apply_steam_info(games, drives)
        self._mark_duplicates(games)
        games.sort(key=lambda g: g["size_bytes"], reverse=True)
        self.log.info("Game scan on %s: %s candidates (%s Steam)", drives, len(games), sum(1 for g in games if g["kind"] == "steam"))
        self.report.finish(cancelled)
        return games

    def _scan_folder(self, folder: Path) -> list[dict]:
        """A folder the player chose: its Steam library if it is one, every game folder inside it, or the folder itself
        when it holds a single game."""
        if not _is_dir(folder):
            self.log.info("Import scan: chosen folder %s does not exist", folder)
            return []
        self.progress(f"Revisando {folder}")
        self.report.folder(folder)
        games: list[dict] = []
        try:
            for steamapps in (folder / "steamapps", folder / "Steam" / "steamapps"):
                if _is_dir(steamapps):
                    games += self._steam_games(steamapps)
            for sub in self._subdirs(folder):
                games += self._collect(sub, "custom", 1)
            if not games:
                games = self._collect(folder, "custom", 1)
        except OSError as error:
            self.log.warning("Scan of %s interrupted: %s", folder, error)
        return games

    @staticmethod
    def _mark_duplicates(games: list[dict]) -> None:
        """The same game found twice (two Steam libraries, a Steam copy and a loose one with its AppID): only the first
        one found can be imported; the others carry `duplicate_of` (the first one's path) so the import list warns."""
        first: dict[int, str] = {}
        for game in games:
            app_id = game.get("app_id")
            if app_id is None:
                continue
            if app_id in first:
                game["duplicate_of"] = first[app_id]
            else:
                first[app_id] = game["path"]

    def _apply_steam_info(self, games: list[dict], drives: list[str]) -> list[dict]:
        """With the local Steam client's appinfo.vdf: drop what Steam says is not a game (a tool, an application...),
        and give a loose folder whose AppID came from an emulator/fix file that game's Steam name instead of the
        folder's ("WRATH.Aeon.of.Ruin.VR.Brutal.Edition"); the folder name stays in `folder_name`."""
        wanted = {g["app_id"] for g in games if g.get("app_id")}
        if not wanted:
            return games
        info = steam_app_info(wanted, self._steam_clients(drives))
        kept = []
        for game in games:
            record = info.get(game.get("app_id")) or {}
            if record.get("type", "") not in GAME_APP_TYPES:
                self.log.info("Import scan: %s skipped, Steam lists AppID %s as %s", game["path"], game["app_id"], record["type"])
                continue
            if game["kind"] == "folder" and record.get("name"):
                game["name"] = record["name"]
            kept.append(game)
        return kept

    def _steam_clients(self, drives: list[str]) -> list[Path]:
        """Folders of the local Steam client: the one the registry names, then any Program Files\\Steam on the disks."""
        clients = []
        if os.name == "nt":
            try:
                import winreg
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
                    clients.append(Path(winreg.QueryValueEx(key, "SteamPath")[0]))
            except OSError:
                pass
        for drive in drives:
            if _is_dir(Path(drive)):
                clients += [folder for folder, source in self._containers(Path(drive)) if source == "steam"]
        return list(dict.fromkeys(clients))

    def _excluded(self, path: Path) -> bool:
        resolved = path.resolve()
        return any(resolved == e or resolved.is_relative_to(e) or e.is_relative_to(resolved) for e in self.exclude)

    def _subdirs(self, folder: Path) -> list[Path]:
        try:
            entries = list(folder.iterdir())
        except OSError:
            return []
        return sorted(p for p in entries if p.name.lower() not in IGNORED_DIRS and _plain(p.name) not in DOWNLOAD_DIRS
                      and _is_dir(p) and not p.is_symlink())

    def _containers(self, root: Path) -> list[tuple[Path, str]]:
        """The usual places, whatever their capitalisation or accents: games folders at the disk root, Downloads, Program Files\\Steam."""
        found = []
        for folder in self._subdirs(root):
            name = _plain(folder.name)
            if name in PROGRAM_FILES:
                found += [(sub, "steam") for sub in self._subdirs(folder) if _plain(sub.name) == "steam"]
            elif name in CONTAINER_NAMES:
                found.append((folder, "library"))
        return found

    # -- Steam --------------------------------------------------------------------------------------
    def _steam_libraries(self, root: Path) -> list[Path]:
        libraries = []
        for folder, _ in self._containers(root):
            for candidate in (folder / "steamapps", folder / "Steam" / "steamapps"):
                if _is_dir(candidate):
                    libraries.append(candidate)
            for sub in self._subdirs(folder):
                if _is_dir(sub / "steamapps"):
                    libraries.append(sub / "steamapps")
        for folder in self._subdirs(root):
            if _is_dir(folder / "steamapps"):
                libraries.append(folder / "steamapps")
        for steamapps in list(libraries):
            vdf = steamapps / "libraryfolders.vdf"
            if _is_file(vdf):
                for path in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="replace")):
                    extra = Path(path.replace("\\\\", "\\")) / "steamapps"
                    if _is_dir(extra) and Path(extra.drive + "\\" if extra.drive else "/") == root:
                        libraries.append(extra)
        return list(dict.fromkeys(p.resolve() for p in libraries))

    def _steam_games(self, steamapps: Path) -> list[dict]:
        games = []
        for manifest in sorted(steamapps.glob("appmanifest_*.acf")):
            try:
                text = manifest.read_text(encoding="utf-8", errors="replace")
                app_id, name, installdir = _acf(text, "appid"), _acf(text, "name"), _acf(text, "installdir")
            except OSError:
                continue
            folder = steamapps / "common" / installdir
            if not (app_id.isdigit() and installdir and _is_dir(folder)):
                continue
            if int(app_id) in IGNORED_APP_IDS or is_ignored_software(name, installdir):
                continue
            size, _, best, _ = self._measure(folder)
            if not best:
                continue                    # no game .exe at all: a tool's data, a soundtrack, a support folder
            games.append({"id": self._key(folder), "name": name or installdir, "path": str(folder), "kind": "steam", "source": "steam",
                          "app_id": int(app_id), "size_bytes": size, "executable": "", "can_move": False})
        return games

    # -- plain folders ------------------------------------------------------------------------------
    def _collect(self, folder: Path, source: str, depth: int) -> list[dict]:
        if time.time() > self._deadline:
            return []
        self.report.folder(folder)
        if is_steam_path(folder):
            return []                       # Steam libraries are read through their manifests
        if is_ignored_software(folder.name):
            return []
        size, top, deeper, declared = self._measure(folder)
        if size < MIN_GAME_BYTES or deeper is None:
            return []                       # too small, or a download still in progress
        if declared and declared[0] in IGNORED_APP_IDS:
            return []
        if top:                              # an exe right in the folder: this is the game
            return [self._candidate(folder, source, size, top, declared)]
        children = []
        if depth < 2:                        # otherwise it may be a folder of games (Repacks\Game)
            for sub in self._subdirs(folder):
                if sub.name.lower() not in TECH_DIRS:
                    children += self._collect(sub, source, depth + 1)
        if children:
            return children
        return [self._candidate(folder, source, size, deeper, declared)] if deeper else []

    @staticmethod
    def _candidate(folder: Path, source: str, size: int, executable: str, declared: tuple[int, str] | None = None) -> dict:
        app_id, app_id_file = declared or (None, "")
        return {"id": GameScanner._key(folder), "name": folder.name, "folder_name": folder.name, "path": str(folder), "kind": "folder", "source": source,
                "app_id": app_id, "app_id_file": app_id_file, "size_bytes": size, "executable": executable, "can_move": True}

    def _measure(self, folder: Path) -> tuple[int, str, str, tuple[int, str] | None]:
        """(bytes, biggest game .exe directly in the folder, biggest one within three levels, (AppID, file) declared by an
        emulator/fix file within five levels) without crawling forever. Installers, uninstallers and redistributables do
        not count as the game's .exe; a half-downloaded file right in the folder (.part, .crdownload...) gives None
        instead of the .exe paths."""
        total, files, best, best_size, top, top_size = 0, 0, "", 0, "", 0
        declared: dict[str, tuple[int, str]] = {}   # lower-case file name -> (AppID, file name as written)
        stack = [(str(folder), 0)]
        read = 0
        while stack and files < MAX_FILES:
            current, depth = stack.pop()
            read += 1
            if read % 200 == 0 and self.report.cancelled():
                raise ScanCancelled()           # a huge game tree must not hold up "Stop"
            try:
                with os.scandir(current) as entries:
                    for entry in entries:
                        try:
                            if entry.is_symlink():
                                continue
                            if entry.is_dir(follow_symlinks=False):
                                if entry.name.lower() not in IGNORED_DIRS:
                                    stack.append((entry.path, depth + 1))
                                continue
                            size = entry.stat(follow_symlinks=False).st_size
                        except OSError:
                            continue
                        files += 1
                        total += size
                        lowered = entry.name.lower()
                        if depth == 0 and PARTIAL_DOWNLOAD.search(lowered):
                            return total, None, None, None
                        if depth <= APP_ID_FILE_DEPTH and lowered in APP_ID_FILES and lowered not in declared:
                            app_id = _declared_app_id(entry.path, lowered)
                            if app_id:
                                declared[lowered] = (app_id, entry.name)
                        if depth <= 3 and lowered.endswith(".exe") and not IGNORED_EXE.search(entry.name):
                            if size > best_size:
                                best, best_size = entry.path, size
                            if depth == 0 and size > top_size:
                                top, top_size = entry.path, size
            except OSError:
                continue
        file = next((name for name in APP_ID_FILES if name in declared), "")
        return total, top, best, declared.get(file)

    @staticmethod
    def _key(folder: Path) -> str:
        return hashlib.sha1(str(folder.resolve()).lower().encode("utf-8")).hexdigest()[:12]
