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

MIN_GAME_BYTES = 200 * 1024 ** 2
MAX_FILES = 60000            # per candidate: stop counting a huge tree rather than crawl it for minutes
MAX_SECONDS = 180
CONTAINER_NAMES = {"games", "game", "juegos", "juego", "library", "libreria", "steam games", "steamlibrary", "gog games",
                   "epic games", "xboxgames", "repacks", "descargas", "downloads"}
PROGRAM_FILES = {"program files", "program files (x86)"}
IGNORED_EXE = re.compile(r"^(unins|setup|install|vcredist|vc_redist|dxsetup|dotnet|crashreport|crashhandler|unitycrash|ue4prereq|oalinst|redist|launcher_updater)|crash|helper|updater|uninstall", re.I)
TECH_DIRS = {"bin", "bin32", "bin64", "binaries", "win32", "win64", "x86", "x64", "game", "release", "shipping", "windows", "retail", "system", "engine"}
IGNORED_DIRS = {"_commonredist", "redist", "__macosx", "$recycle.bin", "system volume information", "windows"}


def _plain(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")


def is_steam_path(path) -> bool:
    """Inside a Steam library ('.../steamapps/...'): Steam owns that structure, so it must never be moved or renamed."""
    return any(part.lower() == "steamapps" for part in Path(path).parts)


def _acf(text: str, key: str) -> str:
    match = re.search(rf'"{key}"\s+"([^"]*)"', text, re.I)
    return match.group(1) if match else ""


class GameScanner:
    def __init__(self, exclude=(), known_app_ids=(), progress=lambda text: None):
        self.exclude = [Path(p).resolve() for p in exclude]
        self.known = {int(i) for i in known_app_ids}
        self.progress = progress
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
    def scan(self, drives: list[str]) -> list[dict]:
        """Candidate games on the chosen disks, biggest first. Steam games carry their AppID."""
        self._deadline = time.time() + MAX_SECONDS
        found: dict[str, dict] = {}
        for drive in drives:
            root = Path(drive)
            if not root.is_dir():
                continue
            self.progress(f"Buscando en {drive}")
            try:
                for steamapps in self._steam_libraries(root):
                    for game in self._steam_games(steamapps):
                        found.setdefault(game["path"], game)
                for container, source in self._containers(root):
                    if source == "steam":
                        continue            # the Steam client folder itself holds no loose games
                    self.progress(f"Revisando {container}")
                    for sub in self._subdirs(container):
                        for game in self._collect(sub, source, 1):
                            found.setdefault(game["path"], game)
            except OSError as error:
                self.log.warning("Scan of %s interrupted: %s", drive, error)
        games = [g for g in found.values() if not self._excluded(Path(g["path"])) and not (g.get("app_id") in self.known)]
        games.sort(key=lambda g: g["size_bytes"], reverse=True)
        self.log.info("Game scan on %s: %s candidates (%s Steam)", drives, len(games), sum(1 for g in games if g["kind"] == "steam"))
        return games

    def _excluded(self, path: Path) -> bool:
        resolved = path.resolve()
        return any(resolved == e or resolved.is_relative_to(e) or e.is_relative_to(resolved) for e in self.exclude)

    def _subdirs(self, folder: Path) -> list[Path]:
        try:
            return sorted(p for p in folder.iterdir() if p.is_dir() and not p.is_symlink() and p.name.lower() not in IGNORED_DIRS)
        except OSError:
            return []

    def _containers(self, root: Path) -> list[tuple[Path, str]]:
        """The usual places, whatever their capitalisation or accents: games folders at the disk root, Downloads, Program Files\\Steam."""
        found = []
        for folder in self._subdirs(root):
            name = _plain(folder.name)
            if name in PROGRAM_FILES:
                found += [(sub, "steam") for sub in self._subdirs(folder) if _plain(sub.name) == "steam"]
            elif name in CONTAINER_NAMES:
                found.append((folder, "downloads" if name in ("descargas", "downloads") else "library"))
        if root.drive and Path(root.drive + "\\") == root:
            profile = os.environ.get("USERPROFILE", "")
            if profile and Path(profile).drive.upper() == root.drive.upper():
                for sub in ("Downloads", "Descargas"):
                    if (Path(profile) / sub).is_dir():
                        found.append((Path(profile) / sub, "downloads"))
        return found

    # -- Steam --------------------------------------------------------------------------------------
    def _steam_libraries(self, root: Path) -> list[Path]:
        libraries = []
        for folder, _ in self._containers(root):
            for candidate in (folder / "steamapps", folder / "Steam" / "steamapps"):
                if candidate.is_dir():
                    libraries.append(candidate)
            for sub in self._subdirs(folder):
                if (sub / "steamapps").is_dir():
                    libraries.append(sub / "steamapps")
        for folder in self._subdirs(root):
            if (folder / "steamapps").is_dir():
                libraries.append(folder / "steamapps")
        for steamapps in list(libraries):
            vdf = steamapps / "libraryfolders.vdf"
            if vdf.is_file():
                for path in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="replace")):
                    extra = Path(path.replace("\\\\", "\\")) / "steamapps"
                    if extra.is_dir() and Path(extra.drive + "\\" if extra.drive else "/") == root:
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
            if not (app_id.isdigit() and installdir and folder.is_dir()):
                continue
            size, _, _ = self._measure(folder)
            games.append({"id": self._key(folder), "name": name or installdir, "path": str(folder), "kind": "steam", "source": "steam",
                          "app_id": int(app_id), "size_bytes": size, "executable": "", "can_move": False})
        return games

    # -- plain folders ------------------------------------------------------------------------------
    def _collect(self, folder: Path, source: str, depth: int) -> list[dict]:
        if time.time() > self._deadline:
            return []
        if is_steam_path(folder):
            return []                       # Steam libraries are read through their manifests
        size, top, deeper = self._measure(folder)
        if size < MIN_GAME_BYTES:
            return []
        if top:                              # an exe right in the folder: this is the game
            return [self._candidate(folder, source, size, top)]
        children = []
        if depth < 2:                        # otherwise it may be a folder of games (Repacks\Game)
            for sub in self._subdirs(folder):
                if sub.name.lower() not in TECH_DIRS:
                    children += self._collect(sub, source, depth + 1)
        if children:
            return children
        return [self._candidate(folder, source, size, deeper)] if deeper else []

    @staticmethod
    def _candidate(folder: Path, source: str, size: int, executable: str) -> dict:
        return {"id": GameScanner._key(folder), "name": folder.name, "path": str(folder), "kind": "folder", "source": source,
                "app_id": None, "size_bytes": size, "executable": executable, "can_move": True}

    def _measure(self, folder: Path) -> tuple[int, str, str]:
        """(bytes, biggest game .exe directly in the folder, biggest one within three levels) without crawling forever."""
        total, files, best, best_size, top, top_size = 0, 0, "", 0, "", 0
        stack = [(str(folder), 0)]
        while stack and files < MAX_FILES:
            current, depth = stack.pop()
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
                        if depth <= 3 and entry.name.lower().endswith(".exe") and not IGNORED_EXE.search(entry.name):
                            if size > best_size:
                                best, best_size = entry.path, size
                            if depth == 0 and size > top_size:
                                top, top_size = entry.path, size
            except OSError:
                continue
        return total, top, best

    @staticmethod
    def _key(folder: Path) -> str:
        return hashlib.sha1(str(folder.resolve()).lower().encode("utf-8")).hexdigest()[:12]
