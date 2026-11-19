"""Persistent Digital paths. Existing game roots stay discoverable after a change."""
from __future__ import annotations
import json
from pathlib import Path
from atomic_json import write_json
from launcher_data import data_dir, default_games_root, default_temporary_root, installed


class DigitalPreferences:
    def __init__(self, launcher):
        self.launcher = Path(launcher).resolve()
        self.path = data_dir(self.launcher) / ".cache" / "digital-settings.json"

    def defaults(self):
        """An installed app uses the installer's folders (or `C:/GA_Juegos` and `Downloads/GameAccessDownloads`);
        a development checkout keeps its built-in folders inside the launcher."""
        if installed():
            return {"games_root": str(default_games_root()), "temporary_root": str(default_temporary_root())}
        return {"games_root": str(self.launcher / "games"), "temporary_root": str(self.launcher / ".cache" / "digital_transfers")}

    def load(self):
        data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.is_file() else {}
        return {**self.defaults(),
                "previous_roots": [],
                # More disks for the library (Seba, 2026-11-17): a folder named like the games folder on each disk the
                # player enabled in Manager › Space (drives.py). New games go where there is most room.
                "library_drives": [],
                # What each disk may be used for (Seba, 2026-11-18): {"E:": {"install": true, "download": false}}. A disk
                # missing here keeps its old meaning: installs where the library has a folder, downloads where the
                # temporary folder is. Game Access picks among the allowed disks (placement in storage.py).
                "drive_roles": {},
                # What each disk keeps free after a game lands on it: the smaller of these two (Seba, 2026-11-18).
                "free_reserve": {"percent": 5, "gb": 30},
                # Delete the downloaded archives/installers once the game is unpacked (the declared fix archive is always kept).
                "delete_download_sources": True,
                # Freeze the games nobody plays: Windows compression after a month, deep freeze after three.
                "auto_freeze": False,
                # After how many days without playing a game is compressed (deep freeze at three times that).
                "auto_freeze_days": 30, **data}

    def save(self, values):
        current = self.load()
        for key in ("games_root", "temporary_root"):
            value = str(values.get(key, current[key])).strip()
            path = Path(value)
            if not value or not path.is_absolute():
                raise ValueError("Selecciona una ruta absoluta.")
            if any(p.is_symlink() or (hasattr(p, "is_junction") and p.is_junction()) for p in [path, *path.parents]):
                raise ValueError("La carpeta no puede estar dentro de un enlace.")
            path = path.resolve()
            if path == Path(path.anchor) or self.launcher.is_relative_to(path):
                raise ValueError("Selecciona una carpeta dedicada, no una raíz de disco o del proyecto.")
            if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
                raise ValueError("La carpeta no puede ser un enlace.")
            current[key] = str(path)
        if "delete_download_sources" in values:
            current["delete_download_sources"] = bool(values["delete_download_sources"])
        if "free_reserve" in values:
            reserve = values["free_reserve"] or {}
            percent, gb = float(reserve.get("percent", 5)), float(reserve.get("gb", 30))
            if not (0 <= percent <= 50 and 0 <= gb <= 2000):
                raise ValueError("La reserva de cada disco va de 0 a 50 % y de 0 a 2000 GB.")
            current["free_reserve"] = {"percent": percent, "gb": gb}
        if "auto_freeze" in values:
            current["auto_freeze"] = bool(values["auto_freeze"])
        if "auto_freeze_days" in values:
            days = int(values["auto_freeze_days"])
            if days not in (30, 60, 90):
                raise ValueError("La autocompresión espera 30, 60 o 90 días.")
            current["auto_freeze_days"] = days
        games, temporary = Path(current["games_root"]), Path(current["temporary_root"])
        if games == temporary or games.is_relative_to(temporary) or temporary.is_relative_to(games):
            raise ValueError("Los juegos y las descargas temporales necesitan carpetas separadas.")
        old = self.load()["games_root"]
        roots = current.get("previous_roots", [])
        if old != current["games_root"]:
            roots = list(dict.fromkeys([*roots, old]))
        current["previous_roots"] = [root for root in roots if root != current["games_root"]]
        if values.get("relocated"):
            # The games of the old folders were moved or linked (relocate.py, which says which old folders still hold
            # a game of ours that is not linked): the rest leave the list, so there is one games folder again.
            current["previous_roots"] = [str(root) for root in values.get("previous_roots", []) if str(root) != current["games_root"]]
        write_json(self.path, current)
        return current

    def set_drive_role(self, letter: str, role: str, on: bool) -> dict:
        """One role of one disk (drives.py checks it before it gets here)."""
        if role not in ("install", "download"):
            raise ValueError("Rol de disco desconocido.")
        current = self.load()
        roles = dict(current.get("drive_roles") or {})
        roles[letter] = {**roles.get(letter, {}), role: bool(on)}
        current["drive_roles"] = roles
        write_json(self.path, current)
        return current

    def set_library_drives(self, folders: list[str]) -> dict:
        """The library's folders on other disks (drives.py checks each one before it gets here)."""
        current = self.load()
        current["library_drives"] = list(dict.fromkeys(str(Path(folder).resolve()) for folder in folders))
        write_json(self.path, current)
        return current
