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
        self.roots = list(dict.fromkeys([self.root, *(Path(root).resolve() for root in settings["previous_roots"])]))
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
        return self.checked(legacy if legacy.is_dir() else self.root / f"{int(app_id)}-{self.folder_name(name)}")

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

    def set_source(self, app_id: int, title: str, provider: str) -> None:
        """Which download this install came from, as its source names it ("Elden Ring v1.10 - FitGirl", "SteamRIP"):
        two downloads of the same game can be different versions that cannot play online together."""
        record = self._record(app_id)
        if record:
            record["source"] = {"title": title.strip(), "provider": provider.strip()}
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
        temporary = Path(self.preferences.load()["temporary_root"])
        if temporary.is_dir():
            existing = sorted(p for p in temporary.glob(f"{int(app_id)}-*") if p.is_dir() and not p.is_symlink())
            if existing:
                return existing[0]
        return temporary / f"{int(app_id)}-{self.folder_name(name)}"

    def transfers(self) -> list[dict]:
        """Downloads sitting in the temporary root, and whether a worker is alive on each right now."""
        temporary = Path(self.preferences.load()["temporary_root"]).resolve()
        found = []
        if not temporary.is_dir():
            return found
        now = time.time()
        for folder in sorted(temporary.iterdir()):
            app_id, title, _ = split_folder_name(folder.name)
            if app_id is None or not folder.is_dir() or folder.is_symlink():
                continue
            live = self.data / ".cache" / "digital_downloads" / f"{app_id}.json"
            # Pieces downloaded from our server keep a state file: they continue exactly where they stopped.
            kind = "pieces" if any(folder.glob(".ga-state-*.json")) else "other"
            found.append({"app_id": app_id, "name": title, "folder": str(folder), "kind": kind,
                          "active": live.is_file() and now - live.stat().st_mtime < 120})
        return found

    def discard_transfer(self, app_id: int) -> None:
        """Delete the leftover temporary download of a game that has no live worker."""
        temporary = Path(self.preferences.load()["temporary_root"]).resolve()
        targets = [t for t in self.transfers() if t["app_id"] == int(app_id)]
        if any(t["active"] for t in targets):
            raise ValueError("La descarga está en curso; cancélala antes de descartarla.")
        for target in targets:
            folder = Path(target["folder"]).resolve()
            if folder == temporary or not folder.is_relative_to(temporary):
                raise ValueError("La carpeta está fuera del directorio permitido.")
            if any(item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()) for item in [folder, *folder.rglob("*")]):
                raise ValueError("La carpeta contiene enlaces; no se pudo eliminar de forma segura.")
            shutil.rmtree(folder)
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
