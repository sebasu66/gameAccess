"""Digital-only folders. No Steam manifests, leases, staging or installers."""
from __future__ import annotations
import json
import re
import shutil
from pathlib import Path
from digital_preferences import DigitalPreferences

LAUNCHER = Path(__file__).resolve().parent

class DigitalGameStorage:
    def __init__(self, launcher: Path = LAUNCHER):
        self.launcher = Path(launcher).resolve()
        self.preferences = DigitalPreferences(self.launcher)
        settings = self.preferences.load()
        self.root = Path(settings["games_root"]).resolve()
        self.roots = list(dict.fromkeys([self.root, *(Path(root).resolve() for root in settings["previous_roots"])]))
        self.registry = self.launcher / ".cache" / "digital_games"

    @staticmethod
    def folder_name(name: str) -> str:
        return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "game"

    def folder(self, app_id: int, name: str) -> Path:
        record = self.registry / f"{int(app_id)}.json"
        if record.is_file():
            data = json.loads(record.read_text(encoding="utf-8"))
            return self.checked(Path(data["folder"]))
        # Identity comes from the Steam AppID prefix, even after a title rename.
        matches = [p for root in self.roots if root.is_dir() for p in root.glob(f"{int(app_id)}-*") if p.is_dir()]
        if len(matches) > 1:
            raise ValueError("Hay varias carpetas para este AppID; se necesita un registro de instalación.")
        if matches:
            return self.checked(matches[0])
        legacy = next((root / self.folder_name(name) for root in self.roots if (root / self.folder_name(name)).is_dir()), self.root / self.folder_name(name))
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

    def register(self, app_id: int, name: str) -> Path:
        folder = self.folder(app_id, name)
        folder.mkdir(parents=True, exist_ok=True)
        self.registry.mkdir(parents=True, exist_ok=True)
        record = self.registry / f"{int(app_id)}.json"
        temporary = record.with_suffix(".tmp")
        temporary.write_text(json.dumps({"folder": str(folder), "name": name}), encoding="utf-8")
        temporary.replace(record)
        return folder

    def status(self, app_id: int, name: str) -> dict:
        folder = self.folder(app_id, name)
        # Archives alone and empty/partial folders are not a runnable download.
        available = folder.is_dir() and any(
            p.is_file() and p.name != ".digital-backup.json" and not re.search(r"\.(?:zip|rar|7z|tar|gz|torrent|part|tmp|download|\d{3})$", p.name, re.I)
            for p in folder.rglob("*")
        )
        return {"folder": str(folder), "installed": available}

    def snapshot(self, games: list[dict]) -> dict:
        # Actual local folders are authoritative; their Steam AppID prefix is
        # the lookup key. Names are only display labels, never fuzzy matches.
        if not any(root.is_dir() for root in self.roots):
            return {}
        games_by_id = {str(int(game["id"])): game for game in games}
        registered = {}
        if self.registry.is_dir():
            for record in self.registry.glob("*.json"):
                game = games_by_id.get(record.stem)
                if game is not None:
                    folder = self.folder(int(record.stem), game["name"])
                    registered.setdefault(str(folder), set()).add(record.stem)
        statuses = {}
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
                        legacy_names.setdefault(self.folder_name(game["name"]), set()).add(app_id)
                app_ids.update(legacy_names.get(folder.name, ()))
            for app_id in app_ids:
                game = games_by_id.get(app_id)
                if game is not None and app_id not in statuses:
                    statuses[app_id] = self.status(int(app_id), game["name"])
        return statuses

    def uninstall(self, app_id: int, name: str) -> Path:
        folder = self.folder(app_id, name)
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
        (self.launcher / ".cache" / "digital_downloads" / f"{int(app_id)}.json").unlink(missing_ok=True)
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
        for root in self.roots:
            if not root.is_dir():
                continue
            for folder in root.iterdir():
                match = re.match(r"^(\d+)-", folder.name)
                if folder.is_dir() and match:
                    self.checked(folder)
                    app_id = int(match[1])
                    found.setdefault(app_id, {"id": app_id, "name": folder.name[len(match[0]):]})
        return list(found.values())
