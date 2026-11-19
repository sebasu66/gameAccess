"""Digital-only folders. No Steam manifests, leases, staging or installers."""
from __future__ import annotations
import json
import re
import shutil
import time
import unicodedata
from pathlib import Path
from atomic_json import write_json
from launcher_data import data_dir
from .preferences import DigitalPreferences
from .linked import LinkedGames

LAUNCHER = Path(__file__).resolve().parent.parent

# A game folder is "<appid>-<name>-<status>". The status is only ever written
# when the game really is in that state, so it can be trusted without
# re-checking the contents. Older folders ("<appid>-<name>") have no status.
STATUSES = ("preparing", "downloading", "installing", "ready", "ERROR")
ERROR_FILE = "error.txt"
import game_journal as journal
from game_journal import JOURNAL_FILE
BACKUP_MARKER = ".digital-backup.json"

def split_folder_name(folder_name: str) -> tuple[int | None, str, str | None]:
    """(app_id, title, status) from a folder name; the app id is the numeric
    prefix and the status the text after the LAST '-' (titles may contain '-')."""
    match = re.match(r"^(\d+)-(.*)$", folder_name)
    if not match:
        return None, folder_name, None
    rest = match.group(2)
    title, _, last = rest.rpartition("-")
    if title and last in STATUSES:
        return int(match.group(1)), title, last
    return int(match.group(1)), rest, None

MAX_LABEL = 120
# Longest title in a game folder's name: with "<appid>-" and "-<status>" the folder name stays short, so the path down to
# a game's .exe (which can sit several folders deep) stays under Windows' 260-character limit.
MAX_FOLDER_TITLE = 40


class DigitalGameStorage:
    def __init__(self, launcher: Path = LAUNCHER):
        self.launcher = Path(launcher).resolve()
        self.data = data_dir(self.launcher)
        self.preferences = DigitalPreferences(self.launcher)
        settings = self.preferences.load()
        self.root = Path(settings["games_root"]).resolve()
        # The library's folders on other disks (drives.py); a disk unplugged leaves its folder out until it is back.
        self.drive_roots = [Path(root).resolve() for root in settings.get("library_drives", []) if Path(root).is_dir()]
        self.roots = list(dict.fromkeys([self.root, *self.drive_roots, *(Path(root).resolve() for root in settings["previous_roots"])]))
        self.registry = self.data / ".cache" / "digital_games"
        self.linked = LinkedGames(self.launcher)

    @staticmethod
    def legacy_folder_name(name: str) -> str:
        """How folders were named before (the title with only Windows' forbidden characters replaced): kept to find
        old folders that have no AppID prefix."""
        return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "game"

    @staticmethod
    def folder_name(name: str) -> str:
        """The title as a folder name: plain ASCII letters and digits only (accents dropped, "™", "®", ":" and the
        like removed), words joined by "_" with no spaces, at most MAX_FOLDER_TITLE characters.
        "Sekiro™: Shadows Die Twice - GOTY Edition" -> "Sekiro_Shadows_Die_Twice_GOTY_Edition"."""
        # Trademark-like signs go first: NFKD would turn "™" into the letters "TM" ("SekiroTM").
        plain = unicodedata.normalize("NFKD", re.sub("[\u2122\u00ae\u00a9\u2120]", " ", name)).encode("ascii", "ignore").decode("ascii")
        words = re.findall(r"[A-Za-z0-9]+", plain)
        title = ""
        for word in words:
            candidate = f"{title}_{word}" if title else word
            if len(candidate) > MAX_FOLDER_TITLE:
                break
            title = candidate
        return title or (words[0][:MAX_FOLDER_TITLE] if words else "game")

    def folder(self, app_id: int, name: str) -> Path:
        # Identity comes from the AppID prefix, never from the title, so a
        # folder is found whatever its name or status suffix is now.
        linked = self.linked.get(app_id)
        if linked:                       # a linked game stays where it is, outside the games roots
            return Path(linked["path"])
        matches = [p for root in self.roots if root.is_dir() for p in root.glob(f"{int(app_id)}-*") if p.is_dir()]
        if len(matches) > 1:
            raise ValueError("Hay varias carpetas para este AppID; se necesita un registro de instalación.")
        if matches:
            return self.checked(matches[0])
        record = self.registry / f"{int(app_id)}.json"
        if record.is_file():
            data = json.loads(record.read_text(encoding="utf-8"))
            registered = Path(data["folder"])
            checked = self.checked(registered)  # refuses roots and outside paths even if stale
            if registered.is_dir():
                return checked
        legacy = next((root / self.legacy_folder_name(name) for root in self.roots if (root / self.legacy_folder_name(name)).is_dir()), self.root / self.legacy_folder_name(name))
        return self.checked(legacy if legacy.is_dir() else self.install_root(app_id=app_id) / f"{int(app_id)}-{self.folder_name(name)}")

    def library_roots(self) -> list[Path]:
        """Where games of the library may live: the games folder and its folders on other disks."""
        return list(dict.fromkeys([self.root, *self.drive_roots]))

    # -- disks and placement (Seba, 2026-11-18) ------------------------------------------------------------------
    # Each disk may be allowed to install games, to hold downloads, both or neither (preferences "drive_roles").
    # Game Access picks among the allowed ones: the fastest disk first (disk_profile.rank_of: NVMe, SSD, hard disk by what Windows says each one is, one over USB last), as long as the game fits and
    # the disk keeps its reserve free (keep_free: the smaller of a share of the disk and some GB, 5 % and 30 GB unless
    # the player chose others; Seba, 2026-11-18); else the next one. A disk already under its reserve takes nothing. The pick for a download is kept for its
    # AppID (`.cache/placement`), so the game folder and the temporary download land where check_space decided.
    def keep_free(self, total: int) -> int:
        """What a disk must keep free after a game lands on it: the smaller of the two the player set."""
        reserve = self.preferences.load()["free_reserve"]
        return int(min(total * float(reserve["percent"]) / 100, float(reserve["gb"]) * 1024 ** 3))

    @staticmethod
    def drive_of(path: Path) -> str:
        resolved = Path(path).resolve()
        return (resolved.drive or resolved.anchor).upper()

    @staticmethod
    def drive_root(letter: str) -> Path:
        return Path(letter + "\\")

    def role(self, letter: str, role: str) -> bool:
        """Whether a disk may install games or hold downloads; without a choice of the player, what it did before."""
        settings = self.preferences.load()
        chosen = (settings.get("drive_roles") or {}).get(letter, {})
        if role in chosen:
            return bool(chosen[role])
        if role == "install":
            return any(self.drive_of(root) == letter for root in self.library_roots())
        return self.drive_of(Path(settings["temporary_root"])) == letter

    def library_folder_on(self, letter: str) -> Path:
        return self.root if self.drive_of(self.root) == letter else self.drive_root(letter) / self.root.name

    def temporary_folder_on(self, letter: str) -> Path:
        temporary = Path(self.preferences.load()["temporary_root"]).resolve()
        return temporary if self.drive_of(temporary) == letter else self.drive_root(letter) / temporary.name

    def install_roots(self) -> list[Path]:
        roots = [root for root in self.library_roots() if self.role(self.drive_of(root), "install")]
        return roots or [self.root]

    def download_roots(self) -> list[Path]:
        settings = self.preferences.load()
        letters = list(dict.fromkeys(self.drive_of(root) for root in [*self.library_roots(), Path(settings["temporary_root"])]))
        letters += [letter for letter in (settings.get("drive_roles") or {}) if letter not in letters]
        roots = [self.temporary_folder_on(letter) for letter in letters if self.role(letter, "download")]
        return roots or [Path(settings["temporary_root"]).resolve()]

    def temporary_roots(self) -> list[Path]:
        """Every folder a download of ours may sit in: the allowed ones and any left from a disk no longer allowed."""
        found = [Path(self.preferences.load()["temporary_root"]).resolve(), *self.download_roots()]
        for root in self.library_roots():
            other = self.temporary_folder_on(self.drive_of(root))
            if other.is_dir():
                found.append(other)
        return list(dict.fromkeys(path.resolve() for path in found))

    def pick(self, roots: list[Path], size: int, reserved: dict[str, int] | None = None, strict: bool = False) -> Path | None:
        """The fastest of `roots` where `size` bytes fit and the disk keeps free what keep_free asks. When none can:
        None if `strict` (the space check says so), else the fastest (a folder is needed anyway, nothing is written)."""
        from disk_space import SAFETY_MARGIN
        from .disk_profile import DiskProfiles, rank_of
        profiles = DiskProfiles(self.data)
        reserved = reserved or {}
        rows = []
        for root in roots:
            letter = self.drive_of(root)
            try:
                usage = shutil.disk_usage(root if root.exists() else self.drive_root(letter))
            except OSError:
                continue
            left = usage.free - int(size) - reserved.get(letter, 0)
            rows.append((rank_of(profiles.known(letter)), left, usage.total, root))
        if not rows:
            return None if strict else roots[0]
        rows.sort(key=lambda row: row[0], reverse=True)
        for _speed, left, total, root in rows:
            if left - SAFETY_MARGIN >= self.keep_free(total):
                return root
        return None if strict else rows[0][3]

    def _placement_file(self, app_id: int) -> Path:
        return self.data / ".cache" / "placement" / f"{int(app_id)}.json"

    def placement(self, app_id: int) -> dict:
        try:
            data = json.loads(self._placement_file(app_id).read_text(encoding="utf-8"))
            return data if time.time() - float(data.get("at", 0)) < 7 * 24 * 3600 else {}
        except (OSError, ValueError, TypeError):
            return {}

    def plan_placement(self, app_id: int, download_bytes: int, factor: float = 1.0, download_left: int | None = None,
                       download_at: Path | None = None) -> dict:
        """Where this download goes and where the game is installed, kept for its AppID. The install is chosen first
        (the fast disk is for playing); a download on the same disk counts on top of it. A download that already began
        stays in its folder (`download_at`) and only what is left of it (`download_left`) still has to fit."""
        size = int(download_bytes or 0)
        left = size if download_left is None else max(0, int(download_left))
        install = self.pick(self.install_roots(), int(size * factor), strict=True)
        reserved = {self.drive_of(install): int(size * factor)} if install else {}
        temporary = download_at if download_at is not None else self.pick(self.download_roots(), left, reserved, strict=True)
        plan = {"install": str(install) if install else "", "download": str(temporary) if temporary else "", "bytes": size, "at": time.time()}
        if app_id and install and temporary:
            write_json(self._placement_file(app_id), plan)
        return plan

    def clear_placement(self, app_id: int) -> None:
        self._placement_file(app_id).unlink(missing_ok=True)

    def install_root(self, size: int = 0, app_id: int = 0) -> Path:
        """Where a new game goes: what was planned for its download (plan_placement), else the policy's pick."""
        planned = self.placement(app_id).get("install") if app_id else None
        if planned and Path(planned).resolve() in [root.resolve() for root in self.install_roots()]:
            return Path(planned).resolve()
        return self.pick(self.install_roots(), size)

    def checked(self, folder: Path) -> Path:
        # Never remove a root, outside folder, or redirected junction/symlink.
        root = self.root.resolve()
        resolved = folder.resolve()
        if not any(resolved != allowed and resolved.is_relative_to(allowed) for allowed in self.roots):
            raise ValueError("La carpeta Digital está fuera del directorio de juegos.")
        if folder.is_symlink() or (hasattr(folder, "is_junction") and folder.is_junction()):
            raise ValueError("La carpeta Digital no puede ser un enlace.")
        return resolved

    def _record(self, app_id: int) -> dict:
        try:
            return json.loads((self.registry / f"{int(app_id)}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _write_record(self, app_id: int, folder: Path, name: str) -> None:
        """The install record keeps what else it knows (the download source) when the folder or name changes."""
        self.registry.mkdir(parents=True, exist_ok=True)
        write_json(self.registry / f"{int(app_id)}.json", {**self._record(app_id), "folder": str(folder), "name": name})

    def set_source(self, app_id: int, title: str, provider: str, link: str = "") -> None:
        """Which download this install came from, as its source names it ("Elden Ring v1.10 - FitGirl", "SteamRIP"):
        two downloads of the same game can be different versions that cannot play online together."""
        record = self._record(app_id)
        if record:
            # The link the download used is shown in the game's properties card (Seba, 2026-11-05).
            record["source"] = {"title": title.strip(), "provider": provider.strip(), **({"link": link.strip()} if link.strip() else {})}
            write_json(self.registry / f"{int(app_id)}.json", record)

    def source(self, app_id: int) -> dict:
        source = self._record(app_id).get("source")
        return source if isinstance(source, dict) else {}

    # Where an unfinished download goes on (download, extract): a retry continues from there instead of starting over.
    RESUME_STEPS = ("download", "extract")

    def set_resume(self, app_id: int, step: str, *, source: str = "", delivery: str = "download", source_title: str = "",
                   source_provider: str = "", auto_installed: bool = False, archive: str = "", error: str = "") -> None:
        """Remember the step an unfinished download is at, with what is needed to go on from there without the
        plugin: the source it came from and, once transferred, the downloaded archive."""
        if step not in self.RESUME_STEPS:
            raise ValueError(f"Paso desconocido: {step}")
        record = self._record(app_id)
        if not record:
            return
        previous = record.get("resume") if isinstance(record.get("resume"), dict) else {}
        record["resume"] = {**previous, "step": step, "at": int(time.time()), "error": error,
                            **({"source": source, "delivery": delivery, "source_title": source_title,
                                "source_provider": source_provider, "auto_installed": bool(auto_installed)} if source else {}),
                            **({"archive": archive} if archive else {})}
        if step == "download":
            record["resume"].pop("archive", None)
        write_json(self.registry / f"{int(app_id)}.json", record)

    def resume_point(self, app_id: int) -> dict:
        """The step an unfinished download is at ({} when there is none). An extract step whose archive is gone
        goes back to the download."""
        resume = self._record(app_id).get("resume")
        if not isinstance(resume, dict) or resume.get("step") not in self.RESUME_STEPS:
            return {}
        if resume["step"] == "extract" and not (resume.get("archive") and Path(resume["archive"]).exists()):
            return {**resume, "step": "download", "archive": ""}
        return dict(resume)

    def clear_resume(self, app_id: int) -> None:
        record = self._record(app_id)
        if record.pop("resume", None) is not None:
            write_json(self.registry / f"{int(app_id)}.json", record)

    def set_label(self, app_id: int, name: str, label: str) -> str:
        """The player's own name for the game in their library (only shown there; the catalog is not touched).
        An empty label goes back to the default: the game as its download source names it."""
        label = " ".join(str(label or "").split())[:MAX_LABEL]
        linked = self.linked.get(app_id)
        record = linked if linked else self._record(app_id)
        if not record:
            folder = self.folder(app_id, name)
            if not folder.is_dir():
                raise ValueError("El juego no está en la biblioteca.")
            record = {"folder": str(folder), "name": name}
        if label:
            record["label"] = label
        else:
            record.pop("label", None)
        target = self.linked.dir if linked else self.registry
        target.mkdir(parents=True, exist_ok=True)
        write_json(target / f"{int(app_id)}.json", record)
        return label

    def label(self, app_id: int) -> str:
        record = self.linked.get(app_id) or self._record(app_id)
        return str(record.get("label") or "")

    def queued_downloads(self) -> set[int]:
        """Games the Download Manager still has to download (queued, paused or running), from its saved queue: a
        queued download may have no temporary files yet."""
        try:
            data = json.loads((self.data / ".cache" / "digital_downloads" / "queue.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return set()
        return {int(job["app_id"]) for job in data.get("jobs", []) if isinstance(job, dict) and str(job.get("app_id", "")).isdigit()
                and job.get("state") not in ("done", "cancelling")}

    def register(self, app_id: int, name: str) -> Path:
        folder = self.folder(app_id, name)
        folder.mkdir(parents=True, exist_ok=True)
        self.registry.mkdir(parents=True, exist_ok=True)
        self._write_record(app_id, folder, name)
        return folder

    def set_status(self, app_id: int, name: str, status: str) -> Path:
        """Rename '<id>-<title>[-<old>]' to '<id>-<title>-<status>' and keep the
        registry pointing at it. Returns the (possibly unchanged) folder."""
        if status not in STATUSES:
            raise ValueError(f"Estado desconocido: {status}")
        folder = self.folder(app_id, name)
        if self.linked.get(app_id):
            return folder                # linked folders are never renamed
        found_id, title, _ = split_folder_name(folder.name)
        if found_id is None:
            title = self.folder_name(name)
        target = self.checked(folder.with_name(f"{int(app_id)}-{title}-{status}"))
        if target != folder:
            if target.exists():
                raise ValueError("Ya existe una carpeta con ese estado para este juego.")
            folder.rename(target)
        self.registry.mkdir(parents=True, exist_ok=True)
        self._write_record(app_id, target, name)
        return target

    def write_error(self, app_id: int, name: str, message: str) -> Path:
        folder = self.folder(app_id, name)
        if self.linked.get(app_id):
            return folder                # nothing is written inside a linked game
        folder.mkdir(parents=True, exist_ok=True)
        journal.note(folder, "ERROR", message)
        return self.set_status(app_id, name, "ERROR")

    @staticmethod
    def is_payload(path: Path) -> bool:
        if path.suffix.lower() in ('.html', '.htm'):
            return False
        try:
            with path.open('rb') as file:
                prefix = file.read(512).lstrip(b'\xef\xbb\xbf \r\n\t').lower()
            return bool(prefix) and not prefix.startswith((b'<!doctype html', b'<html', b'<head', b'<body'))
        except OSError:
            return False

    def status(self, app_id: int, name: str) -> dict:
        linked = self.linked.get(app_id)
        if linked:
            return self.linked.status(linked)
        folder = self.folder(app_id, name)
        _, _, state = split_folder_name(folder.name)
        result = {"folder": str(folder), "installed": False, "state": state}
        if state == "ready":
            # The status is only written once the game was unpacked and its
            # executable found, so it is not re-verified on every query.
            result["installed"] = folder.is_dir() and any(self.has_content(folder))
        elif state == "ERROR":
            # The reason lives in the game's own log; error.txt is only read for folders from before the log existed.
            error_file = folder / ERROR_FILE
            result["error"] = (journal.last(folder, "ERROR") or (error_file.read_text(encoding="utf-8", errors="replace") if error_file.is_file() else ""))[:4000]
            result["needs_repair"] = True
        elif state is None:
            # Folders from before statuses existed: archives alone and
            # empty/partial folders are not a runnable download.
            result["installed"] = folder.is_dir() and any(
                p.is_file() and p.name not in (BACKUP_MARKER, ERROR_FILE, JOURNAL_FILE) and not re.search(r"\.(?:zip|rar|7z|tar|gz|torrent|part|tmp|download|\d{3})$", p.name, re.I) and self.is_payload(p)
                for p in folder.rglob("*")
            )
            result["needs_repair"] = not result["installed"] and folder.is_dir() and any(self.has_content(folder))
        return result

    @staticmethod
    def has_content(folder: Path):
        """Entries that are not bookkeeping files (error.txt, backup marker)."""
        return (item for item in folder.iterdir() if item.name not in (BACKUP_MARKER, ERROR_FILE, JOURNAL_FILE))

    def prune_empty(self, min_age_seconds: float = 600) -> list[Path]:
        """Remove leftover EMPTY '<appid>-<name>' folders (no status) that nothing is using.

        Folders with a status are never touched: an empty 'downloading' folder
        is normal while the files still sit in the temporary root. A folder is
        also kept while its worker is alive (the status file is rewritten every
        second) or while it is young."""
        removed = []
        now = time.time()
        for root in self.roots:
            if not root.is_dir():
                continue
            for folder in root.iterdir():
                app_id, _, state = split_folder_name(folder.name)
                if app_id is None or state not in (None, "preparing"):
                    continue
                try:
                    if not folder.is_dir() or folder.is_symlink() or any(folder.iterdir()):
                        continue
                    if now - folder.stat().st_mtime < min_age_seconds:
                        continue
                    live = self.data / ".cache" / "digital_downloads" / f"{app_id}.json"
                    if live.is_file() and now - live.stat().st_mtime < 120:
                        continue
                    folder.rmdir()
                    record = self.registry / f"{app_id}.json"
                    if record.is_file():
                        try:
                            if Path(json.loads(record.read_text(encoding="utf-8")).get("folder", "")) == folder:
                                record.unlink()
                        except (OSError, ValueError):
                            pass
                    removed.append(folder)
                except OSError:
                    continue
        return removed

    def remove_empty(self, app_id: int, folder: Path) -> None:
        """Remove a game folder that holds nothing (the temporary download, if any, is left alone)."""
        folder = self.checked(folder)
        if any(self.has_content(folder)):
            raise ValueError("La carpeta no está vacía.")
        shutil.rmtree(folder)  # only bookkeeping files (log, backup marker) can be left in it
        (self.registry / f"{int(app_id)}.json").unlink(missing_ok=True)

    def transfer_folder(self, app_id: int, name: str) -> Path:
        """Where a game's download goes: the temporary folder it already has (whatever its name, found by its AppID, so
        a download started before the folder names changed still resumes), or a new "<appid>-<clean name>" one."""
        for temporary in self.temporary_roots():
            if temporary.is_dir():
                existing = sorted(p for p in temporary.glob(f"{int(app_id)}-*") if p.is_dir() and not p.is_symlink())
                if existing:
                    return existing[0]
        planned = self.placement(app_id).get("download")
        allowed = [root.resolve() for root in self.download_roots()]
        temporary = Path(planned).resolve() if planned and Path(planned).resolve() in allowed else self.pick(self.download_roots(), 0)
        return temporary / f"{int(app_id)}-{self.folder_name(name)}"

    def transfers(self) -> list[dict]:
        """Downloads sitting in the temporary root, and whether a worker is alive on each right now."""
        found = []
        now = time.time()
        folders = [folder for temporary in self.temporary_roots() if temporary.is_dir() for folder in sorted(temporary.iterdir())]
        for folder in folders:
            app_id, title, _ = split_folder_name(folder.name)
            if app_id is None or not folder.is_dir() or folder.is_symlink():
                continue
            live = self.data / ".cache" / "digital_downloads" / f"{app_id}.json"
            # Pieces downloaded from our server keep a state file: they continue exactly where they stopped.
            kind = "pieces" if any(folder.glob(".ga-state-*.json")) else "other"
            found.append({"app_id": app_id, "name": title, "folder": str(folder), "kind": kind,
                          "active": live.is_file() and now - live.stat().st_mtime < 120 and not self._ended(live)})
        return found

    @staticmethod
    def _ended(live: Path) -> bool:
        """A worker's last word was the end (finished, failed, cancelled): its progress file is fresh but nothing runs."""
        try:
            return json.loads(live.read_text(encoding="utf-8")).get("phase") in ("completed", "error", "cancelled", "interrupted", "external")
        except (OSError, ValueError, AttributeError):
            return False

    def discard_transfer(self, app_id: int, game_folder: bool = False) -> None:
        """Delete the leftover temporary download of a game that has no live worker. With `game_folder` (the player's
        own "Discard"), also the unfinished folder the download left in the games folder (unpacked, its installer
        failed...) and its resume point, so the next scan does not offer it again. A finished install is never touched;
        the automatic clean-up of empty downloads never passes it."""
        temporaries = self.temporary_roots()
        targets = [t for t in self.transfers() if t["app_id"] == int(app_id)]
        if any(t["active"] for t in targets):
            raise ValueError("La descarga está en curso; cancélala antes de descartarla.")
        for target in targets:
            folder = Path(target["folder"]).resolve()
            if not any(folder != temporary and folder.is_relative_to(temporary) for temporary in temporaries):
                raise ValueError("La carpeta está fuera del directorio permitido.")
            if any(item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()) for item in [folder, *folder.rglob("*")]):
                raise ValueError("La carpeta contiene enlaces; no se pudo eliminar de forma segura.")
            shutil.rmtree(folder)
        game_folders = [] if not game_folder else [p for root in self.roots if root.is_dir() for p in root.glob(f"{int(app_id)}-*") if p.is_dir()]
        unfinished = [p for p in game_folders if split_folder_name(p.name)[2] != "ready"]
        for folder in unfinished:
            self.checked(folder)
            if any(item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()) for item in [folder, *folder.rglob("*")]):
                raise ValueError("La carpeta contiene enlaces; no se pudo eliminar de forma segura.")
            shutil.rmtree(folder)
        if unfinished and len(unfinished) == len(game_folders):
            (self.registry / f"{int(app_id)}.json").unlink(missing_ok=True)   # nothing of the game is left
        elif game_folder:
            self.clear_resume(app_id)
        for leftover in ((self.data / ".cache" / "digital_downloads" / f"{int(app_id)}.json"),
                         (self.data / ".cache" / "digital_downloads" / f"{int(app_id)}.control.json")):
            leftover.unlink(missing_ok=True)

    def snapshot(self, games: list[dict]) -> dict:
        # Actual local folders are authoritative; their Steam AppID prefix is
        # the lookup key. Names are only display labels, never fuzzy matches.
        if not any(root.is_dir() for root in self.roots):
            return {}
        self.prune_empty()
        games_by_id = {str(int(game["id"])): game for game in games}
        registered = {}
        if self.registry.is_dir():
            for record in self.registry.glob("*.json"):
                game = games_by_id.get(record.stem)
                if game is not None:
                    folder = self.folder(int(record.stem), game["name"])
                    registered.setdefault(str(folder), set()).add(record.stem)
        statuses = {}
        for record in self.linked.all():
            statuses[str(record["app_id"])] = self.linked.status(record)
        legacy_names = None
        for folder in (folder for root in self.roots if root.is_dir() for folder in root.iterdir()):
            if not folder.is_dir():
                continue
            app_ids = set(registered.get(str(folder.resolve()), ()))
            prefix = re.match(r"^(\d+)-", folder.name)
            if prefix:
                app_ids.add(prefix.group(1))
            elif not app_ids:
                # Compatibility for old unregistered folders: exact names only.
                if legacy_names is None:
                    legacy_names = {}
                    for app_id, game in games_by_id.items():
                        legacy_names.setdefault(self.legacy_folder_name(game["name"]), set()).add(app_id)
                app_ids.update(legacy_names.get(folder.name, ()))
            for app_id in app_ids:
                game = games_by_id.get(app_id)
                if game is not None and app_id not in statuses:
                    statuses[app_id] = self.status(int(app_id), game["name"])
        return statuses

    def uninstall(self, app_id: int, name: str) -> Path:
        folder = self.folder(app_id, name)
        if self.linked.get(app_id):
            self.linked.unlink(app_id)   # only the link goes; the game's files are not ours to delete
            return folder
        temporary_root = Path(self.preferences.load()["temporary_root"]).resolve()
        temporary_folders = list(temporary_root.glob(f"{int(app_id)}-*")) if temporary_root.is_dir() else []
        targets = [folder, *temporary_folders]
        for target in targets:
            allowed = temporary_root if target in temporary_folders else next(root for root in self.roots if target.is_relative_to(root))
            if target.resolve() == allowed or not target.resolve().is_relative_to(allowed):
                raise ValueError("La carpeta está fuera del directorio permitido.")
            for item in [target, *target.rglob("*")] if target.exists() else [target]:
                if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
                    raise ValueError("La carpeta contiene enlaces; no se pudo eliminar de forma segura.")
        for target in targets:
            if target.exists():
                shutil.rmtree(target)
        (self.registry / f"{int(app_id)}.json").unlink(missing_ok=True)
        # Avoid rediscovering an obsolete completed transfer after deletion.
        (self.data / ".cache" / "digital_downloads" / f"{int(app_id)}.json").unlink(missing_ok=True)
        return folder

    def present(self, app_id: int, name: str) -> dict:
        """What the game already has on disk: its games folder and its temporary download, each only when it holds a
        file. A folder that cannot be told apart counts as present (it is then kept)."""
        def holds(path: Path) -> bool:
            return path.is_dir() and any(item.is_file() for item in path.rglob("*"))
        try:
            game = self.linked.get(app_id) is not None or holds(self.folder(app_id, name))
        except (OSError, ValueError):
            game = True
        temporary_root = Path(self.preferences.load()["temporary_root"])
        transfer = temporary_root.is_dir() and any(holds(path) for path in temporary_root.glob(f"{int(app_id)}-*"))
        return {"game": game, "transfer": transfer}

    def remove_new(self, app_id: int, name: str, before: dict) -> list[str]:
        """Automatic cleanup (a cancelled download, a dead source, a download that held no game) removes only what
        that run created. A games folder or a download that already held files when it started is never deleted
        without the player asking (Seba, 2026-11-05: a cancelled download took Solasta II's working folder with it).
        Returns what was kept."""
        kept = [part for part in ("game", "transfer") if before.get(part, True)]
        if not kept:
            self.uninstall(app_id, name)
            return kept
        if "transfer" not in kept:
            self._remove_transfers(app_id)
        return kept

    def _remove_transfers(self, app_id: int) -> None:
        """The game's temporary download folders, never through a link out of the temporary root."""
        targets = [(root, target) for root in self.temporary_roots() if root.is_dir() for target in root.glob(f"{int(app_id)}-*")]
        for temporary_root, target in targets:
            resolved = target.resolve()
            if resolved == temporary_root or not resolved.is_relative_to(temporary_root) or target.is_symlink():
                continue
            if any(item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()) for item in target.rglob("*")):
                continue
            shutil.rmtree(target)

    def abandon_download(self, app_id: int, name: str) -> None:
        """The player aborts a download that stopped (error, interrupted): what it left to go on from goes (the
        temporary download and where it stopped); the game's folder only when it holds no file, so a game that was
        already there stays (remove_new)."""
        self._remove_transfers(app_id)
        self.clear_resume(app_id)
        if self.linked.get(app_id):
            return
        try:
            folder = self.folder(app_id, name)
            empty = folder.is_dir() and not any(item.is_file() for item in folder.rglob("*"))
        except (OSError, ValueError):
            return
        if empty:
            self.uninstall(app_id, name)

    def local_games(self):
        found = {}
        if self.registry.is_dir():
            for record in self.registry.glob("*.json"):
                if not record.stem.isdigit():
                    continue
                data = json.loads(record.read_text(encoding="utf-8"))
                self.folder(int(record.stem), data.get("name", "game"))
                found[int(record.stem)] = {"id": int(record.stem), "name": data.get("name", "game")}
        for record in self.linked.all():
            found[record["app_id"]] = {"id": record["app_id"], "name": record["name"]}
        for root in self.roots:
            if not root.is_dir():
                continue
            for folder in root.iterdir():
                app_id, title, _ = split_folder_name(folder.name)
                if folder.is_dir() and app_id is not None:
                    self.checked(folder)
                    found.setdefault(app_id, {"id": app_id, "name": title})
        return list(found.values())
