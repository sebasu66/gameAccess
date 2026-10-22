"""Freezer: gives disk space back from games nobody plays, in two levels.

    freeze  Windows compression (LZX, `compact /exe:LZX`), file by file. The game stays playable as it is: Windows
            decompresses each file while reading it. Measured on Portal 2: 15.0 GB -> 10.2 GB in 3 minutes.
    deep    One 7-Zip archive (LZMA2, normal level), like a repack. The game must be thawed before it runs (Play
            does it). Measured on Portal 2: 15.0 GB -> 9.0 GB in 4.5 minutes; thawing took 26 seconds there.

Only games Game Access owns: a "<appid>-<name>-ready" folder in the games roots (downloaded, or imported by
moving). A linked game is never touched. The deep archive stays inside the game's own folder, next to its log,
so the rest of the app still sees the game as installed. Each frozen game has a record in
`.cache/digital_frozen/<appid>.json`; nothing is deleted before the archive was tested and its size checked.
"""
from __future__ import annotations
import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import game_journal as journal
from atomic_json import write_json
from disk_space import folder_size
from game_download_manager.extractor import find_portable_7z
from .storage import BACKUP_MARKER, ERROR_FILE, split_folder_name

LEVELS = ("freeze", "deep")
DEEP_ARCHIVE = ".gameaccess-deep-freeze.7z"
KEEP = (journal.JOURNAL_FILE, BACKUP_MARKER, ERROR_FILE)  # stay outside the archive: the game's history and markers
FREEZE_DAYS, DEEP_DAYS = 30, 90
NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


_compressed_size = None
if sys.platform == "win32":
    _compressed_size = ctypes.WinDLL("kernel32", use_last_error=True).GetCompressedFileSizeW
    _compressed_size.restype = ctypes.c_ulong
    _compressed_size.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]


def on_disk(path: Path) -> int:
    """Bytes a file really takes on disk (less than its size when Windows compressed it)."""
    if _compressed_size is None:
        return path.stat().st_size
    high = ctypes.c_ulong(0)
    low = _compressed_size(str(path), ctypes.byref(high))
    if low == 0xFFFFFFFF and ctypes.get_last_error():
        return path.stat().st_size
    return (high.value << 32) + low


def folder_on_disk(folder: Path) -> int:
    return sum(on_disk(p) for p in folder.rglob("*") if p.is_file() and not p.is_symlink())


def compressed_sizes(folder: Path) -> tuple[int, int] | None:
    """(real size, size on disk) when Windows compression saves space in the folder, else None. Finds games
    compressed without a record: a freeze whose record was never written, or `compact` run by hand."""
    files = [p for p in folder.rglob("*") if p.is_file() and not p.is_symlink()]
    size, stored = sum(p.stat().st_size for p in files), sum(on_disk(p) for p in files)
    return (size, stored) if size and stored < size * 0.97 else None  # under 3 %: nothing worth showing


def _payload_size(folder: Path) -> int:
    """The game's own bytes: everything except its log, markers and a deep archive."""
    skip = {*KEEP, DEEP_ARCHIVE, DEEP_ARCHIVE + ".tmp"}
    return sum(p.stat().st_size for p in folder.rglob("*") if p.is_file() and not p.is_symlink()
               and not (p.parent == folder and p.name in skip))


def running_under(folder: Path) -> bool:
    """Whether a program started from inside the game's folder is running now."""
    if sys.platform != "win32":
        return False
    script = "Get-CimInstance Win32_Process | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ }"
    try:
        out = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                             capture_output=True, text=True, timeout=60, creationflags=NO_WINDOW).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    prefix = str(folder.resolve()).lower().rstrip("\\") + "\\"
    return any(line.strip().lower().startswith(prefix) for line in out.splitlines())


class GameFreezer:
    def __init__(self, storage, logger=None, seven_zip: str | None = None, run=subprocess.run, is_running=running_under, now=time.time):
        self.storage = storage
        self.log = logger
        self.seven_zip = seven_zip
        self._run = run
        self._is_running = is_running
        self.now = now
        self.records = storage.data / ".cache" / "digital_frozen"

    # -- records -----------------------------------------------------------------------------
    def record(self, app_id: int) -> dict | None:
        path = self.records / f"{int(app_id)}.json"
        try:
            return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
        except (OSError, ValueError):
            return None

    def _save(self, app_id: int, record: dict) -> None:
        self.records.mkdir(parents=True, exist_ok=True)
        write_json(self.records / f"{int(app_id)}.json", record)

    def forget(self, app_id: int) -> None:
        """The game was uninstalled: its record goes too (the archive went with the folder)."""
        (self.records / f"{int(app_id)}.json").unlink(missing_ok=True)

    def is_deep(self, app_id: int) -> bool:
        record = self.record(app_id)
        return bool(record and record.get("level") == "deep")

    def describe(self, app_id: int, folder: Path, with_sizes: bool = True) -> dict:
        """What the library shows: the level, the real size and what it takes on disk now."""
        record = self.record(app_id)
        if not record or Path(record.get("folder", "")) != folder:
            found = compressed_sizes(folder) if with_sizes and folder.is_dir() else None
            return {"frozen": "freeze", "frozen_bytes": found[1], "original_bytes": found[0]} if found else {}
        stored = folder_on_disk(folder) if with_sizes and folder.is_dir() else record.get("stored_bytes")
        return {"frozen": record["level"], "frozen_bytes": stored, "original_bytes": record.get("original_bytes")}

    # -- checks --------------------------------------------------------------------------------
    def _target(self, app_id: int, name: str) -> Path:
        if self.storage.linked.get(app_id):
            raise ValueError("Es un juego vinculado: Game Access no modifica sus archivos, así que no se puede congelar.")
        folder = self.storage.folder(app_id, name)
        if split_folder_name(folder.name)[2] != "ready" or not folder.is_dir():
            raise ValueError("Solo se congelan juegos instalados y listos para jugar.")
        if self._is_running(folder):
            raise ValueError("El juego está abierto: cerralo antes de congelarlo o descongelarlo.")
        return folder

    def _tool(self) -> str:
        tool = self.seven_zip or find_portable_7z()
        if not tool:
            raise RuntimeError("No se encontró 7-Zip para el congelado profundo.")
        return tool

    def _exec(self, args: list[str], what: str, cwd: Path | None = None) -> str:
        done = self._run(args, cwd=str(cwd) if cwd else None, capture_output=True, text=True, errors="replace", creationflags=NO_WINDOW)
        if done.returncode != 0:
            raise RuntimeError(f"{what} terminó con código {done.returncode}: {(done.stderr or done.stdout or '').strip()[-300:]}")
        return done.stdout or ""

    def _listed_bytes(self, tool: str, archive: Path) -> int:
        """Total size of the files the archive holds, from 7-Zip's own listing (its last line sums them)."""
        listing = self._exec([tool, "l", "-y", str(archive)], "El listado del archivo")
        for line in reversed(listing.splitlines()):
            match = re.search(r"(\d+)\s+(\d+)\s+\d+\s+files?", line)
            if match:
                return int(match.group(1))
        raise RuntimeError("7-Zip no informó el tamaño del archivo.")

    def _note(self, folder: Path, text: str) -> None:
        journal.note(folder, "freeze", text)
        if self.log:
            self.log.info("%s: %s", folder.name, text)

    # -- the two levels ---------------------------------------------------------------------------
    def freeze(self, app_id: int, name: str) -> dict:
        """Windows compression: playable without thawing."""
        folder = self._target(app_id, name)
        if self.is_deep(app_id):
            raise ValueError("El juego ya está en congelado profundo.")
        original = _payload_size(folder)
        started = self.now()
        # /i keeps going past files in use; Windows skips files that would not shrink.
        self._exec(["compact.exe", "/c", f"/s:{folder}", "/i", "/q", "/exe:LZX"], "La compresión de Windows")
        stored = folder_on_disk(folder)
        record = {"level": "freeze", "folder": str(folder), "original_bytes": original, "stored_bytes": stored,
                  "frozen_at": datetime.now().isoformat(timespec="seconds")}
        self._save(app_id, record)
        self._note(folder, f"congelado (compresión de Windows): {original / 1e9:.1f} GB -> {stored / 1e9:.1f} GB en {self.now() - started:.0f} s")
        return record

    def deep_freeze(self, app_id: int, name: str) -> dict:
        """One 7-Zip archive inside the game folder; the files are removed only after the archive checks out."""
        folder = self._target(app_id, name)
        if self.is_deep(app_id):
            raise ValueError("El juego ya está en congelado profundo.")
        tool = self._tool()
        original = _payload_size(folder)
        free = shutil.disk_usage(folder).free
        if free < original:
            raise ValueError(f"No hay espacio para el archivo temporal: hacen falta {original / 1e9:.1f} GB libres y hay {free / 1e9:.1f} GB.")
        archive, partial = folder / DEEP_ARCHIVE, folder / (DEEP_ARCHIVE + ".tmp")
        partial.unlink(missing_ok=True)
        started = self.now()
        excluded = [f"-x!{kept}" for kept in (*KEEP, DEEP_ARCHIVE, DEEP_ARCHIVE + ".tmp")]  # top level only
        try:
            self._exec([tool, "a", "-t7z", "-m0=lzma2", "-mx5", "-mmt=on", "-y", "-bso0", "-bsp0", str(partial), "*", *excluded],
                       "7-Zip", cwd=folder)
            self._exec([tool, "t", "-y", "-bso0", "-bsp0", str(partial)], "La prueba del archivo")
            listed = self._listed_bytes(tool, partial)
            if listed != original:
                raise RuntimeError(f"El archivo guarda {listed} bytes y el juego tiene {original}: no se borra nada.")
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        os.replace(partial, archive)
        record = {"level": "deep", "folder": str(folder), "original_bytes": original, "stored_bytes": archive.stat().st_size,
                  "frozen_at": datetime.now().isoformat(timespec="seconds"), "phase": "clearing"}
        self._save(app_id, record)  # from here a thaw restores the game, whatever is left in the folder
        for item in folder.iterdir():
            if item.name in (*KEEP, DEEP_ARCHIVE):
                continue
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()
        record.pop("phase")
        record["stored_bytes"] = folder_on_disk(folder)
        self._save(app_id, record)
        self._note(folder, f"congelado profundo (7-Zip): {original / 1e9:.1f} GB -> {record['stored_bytes'] / 1e9:.1f} GB en {self.now() - started:.0f} s")
        return record

    def thaw(self, app_id: int, name: str) -> dict:
        """Undo either level. A deep freeze needs the game's full size free on the disk."""
        record = self.record(app_id)
        if not record:
            folder = self._target(app_id, name)
            if not compressed_sizes(folder):
                return {"thawed": False}
            record = {"level": "freeze"}  # compressed without a record: Windows decompression, like a normal freeze
        else:
            folder = self._target(app_id, name)
        started = self.now()
        if record["level"] == "deep":
            archive = folder / DEEP_ARCHIVE
            if not archive.is_file():
                raise RuntimeError("Falta el archivo del congelado profundo: el juego no se puede recuperar desde acá.")
            needed = record["original_bytes"] - _payload_size(folder)
            free = shutil.disk_usage(folder).free
            if free < needed:
                raise ValueError(f"No hay espacio para descongelar: hacen falta {needed / 1e9:.1f} GB libres y hay {free / 1e9:.1f} GB.")
            self._exec([self._tool(), "x", "-y", "-aoa", "-bso0", "-bsp0", f"-o{folder}", str(archive)], "7-Zip")
            restored = _payload_size(folder)
            if restored != record["original_bytes"]:
                raise RuntimeError(f"Se recuperaron {restored} bytes de {record['original_bytes']}: el archivo se conserva.")
            archive.unlink()
        else:
            self._exec(["compact.exe", "/u", f"/s:{folder}", "/i", "/q", "/exe"], "La descompresión de Windows")
        self.forget(app_id)
        self._note(folder, f"descongelado ({'congelado profundo' if record['level'] == 'deep' else 'compresión de Windows'}) en {self.now() - started:.0f} s")
        return {"thawed": True, "level": record["level"]}

    def ensure_thawed(self, app_id: int, name: str) -> bool:
        """Before Play, repair or analysis: a deep-frozen game is brought back. Windows compression needs nothing."""
        if not self.is_deep(app_id):
            return False
        self.thaw(app_id, name)
        return True

    # -- automatic --------------------------------------------------------------------------------
    def last_use(self, folder: Path) -> float:
        """The last launch in the game's log; a game never launched counts from when its folder was made."""
        last = ""
        for line in journal.read(folder).splitlines():
            parts = line.split(" | ", 2)
            if len(parts) == 3 and parts[1] == "play" and parts[2].startswith("lanzado"):
                last = parts[0]
        try:
            return datetime.strptime(last, "%Y-%m-%d %H:%M:%S").timestamp() if last else folder.stat().st_ctime
        except ValueError:
            return folder.stat().st_ctime

    def auto(self, freeze_days: int = FREEZE_DAYS, deep_days: int = DEEP_DAYS, limit: int = 1) -> list[dict]:
        """Freeze the games unused for `freeze_days` and deep-freeze those unused for `deep_days`, at most
        `limit` per call (each one can take minutes). Games in use or linked are left alone."""
        done: list[dict] = []
        for root in self.storage.roots:
            if not root.is_dir():
                continue
            for folder in sorted(root.iterdir()):
                if len(done) >= limit:
                    return done
                app_id, title, state = split_folder_name(folder.name)
                if app_id is None or state != "ready" or not folder.is_dir() or self.storage.linked.get(app_id):
                    continue
                idle_days = (self.now() - self.last_use(folder)) / 86400
                level = (self.record(app_id) or {}).get("level")
                wanted = "deep" if idle_days >= deep_days else "freeze" if idle_days >= freeze_days else None
                if wanted is None or level == "deep" or level == wanted:
                    continue
                try:
                    (self.deep_freeze if wanted == "deep" else self.freeze)(app_id, title)
                    done.append({"app_id": app_id, "ok": True, "level": wanted})
                except (OSError, ValueError, RuntimeError) as error:
                    done.append({"app_id": app_id, "ok": False, "level": wanted, "error": str(error)})
        return done
