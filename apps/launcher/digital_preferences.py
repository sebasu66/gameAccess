"""Persistent Digital paths. Existing game roots stay discoverable after a change."""
from __future__ import annotations
import json
import os
from pathlib import Path

class DigitalPreferences:
    def __init__(self, launcher):
        self.launcher = Path(launcher).resolve()
        self.path = self.launcher / ".cache" / "digital-settings.json"

    def load(self):
        data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.is_file() else {}
        return {"games_root": str(self.launcher / "games"),
                "temporary_root": str(self.launcher / ".cache" / "digital_transfers"),
                "previous_roots": [], **data}

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
        games, temporary = Path(current["games_root"]), Path(current["temporary_root"])
        if games == temporary or games.is_relative_to(temporary) or temporary.is_relative_to(games):
            raise ValueError("Los juegos y las descargas temporales necesitan carpetas separadas.")
        old = self.load()["games_root"]
        roots = current.get("previous_roots", [])
        if old != current["games_root"]:
            roots = list(dict.fromkeys([*roots, old]))
        current["previous_roots"] = [root for root in roots if root != current["games_root"]]
        self.write(self.path, current)
        return current

    @staticmethod
    def write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
