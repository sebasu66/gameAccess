"""Freezer: gives disk space back from games nobody plays, in two levels.

    freeze  Windows compression (LZX, what `compact /exe:LZX` does), each file on its own thread so every core
            works at once (`compact` alone goes file by file on one core). The game stays playable as it is: Windows
            decompresses each file while reading it.
    deep    One 7-Zip archive (LZMA2, fastest level, every core), like a repack. The game must be thawed before it
            runs (Play does it).

While it works, each freeze or thaw writes its progress (step, share, bytes, file, a short list of events) to
`.cache/digital_frozen/<appid>.progress.json`; the desktop reads it to draw its console (FreezeProgress).

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
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import game_journal as journal
from atomic_json import write_json
from disk_space import folder_size
from game_download_manager.extractor import find_portable_7z
from . import wof
from .freeze_control import FreezeBusy, FreezeCancelled, FreezeControl, lower_priority, pid_alive, resume, suspend
from .storage import BACKUP_MARKER, ERROR_FILE, split_folder_name

LEVELS = ("freeze", "deep")
# The deep freeze's archive is named after its game, so it says what it is wherever it ends up (Seba, 2026-10-30):
# "<AppID>-<title>.congelado-gameaccess.7z", without the folder's status (the folder is renamed when it changes).
DEEP_SUFFIX = ".congelado-gameaccess.7z"


def deep_archive_for(folder: Path) -> Path:
    """Where a deep freeze of this folder writes its archive."""
    app_id, title, _ = split_folder_name(folder.name)
    stem = f"{app_id}-{title}" if app_id is not None else folder.name
    return folder / f"{stem}{DEEP_SUFFIX}"


def deep_archive(folder: Path) -> Path | None:
    """The deep freeze's archive in this folder; None when there is none."""
    try:
        return next((item for item in folder.iterdir() if item.is_file() and item.name.endswith(DEEP_SUFFIX)), None)
    except OSError:
        return None


def deep_archive_names(folder: Path) -> set[str]:
    """The names a deep freeze's archive and its unfinished copy can have in this folder (kept out of the payload)."""
    names = {deep_archive_for(folder).name}
    found = deep_archive(folder)
    if found:
        names.add(found.name)
    return names | {name + ".tmp" for name in names}
KEEP = (journal.JOURNAL_FILE, BACKUP_MARKER, ERROR_FILE)  # stay outside the archive: the game's history and markers
FREEZE_DAYS, DEEP_DAYS = 30, 90
NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
# 7-Zip level of the deep freeze. Measured on a 2.5 GB game: level 5 took 71 s for 1.56 GB, level 3 48 s for 1.60 GB,
# level 1 24.5 s for 1.62 GB. Level 1: three times faster for 4 % more on disk. (Testing the archive takes 2-3 s.)
DEEP_LEVEL = 1
BIG_FILE = 64 * 1024 * 1024        # a file this big gets its own line in the console
SEVEN_ZIP_PROGRESS = re.compile(r"^\s*(\d{1,3})%(?:\s+\d+)?(?:\s+[+=TUR-]\s+(.*?))?\s*$")
# The steps of each action and their share of the whole bar.
STEPS = {"freeze": (("scan", 1), ("compress", 99)),
         "deep": (("scan", 1), ("compress", 82), ("verify", 15), ("clear", 2)),
         "thaw": (("decompress", 100),),
         "thaw-deep": (("extract", 97), ("check", 3)),
         # A linked game moved into the library (mover.py): copied, the original removed, adopted to the standard.
         "move": (("move", 96), ("clear", 2), ("adopt", 2))}
MAX_EVENTS = 80


class FreezeProgress:
    """What the app shows while a game is frozen or thawed, kept in a small JSON file: the step and its share, the
    share of the whole, bytes done, the file being worked on and the last events (files found, threads, a big file
    done...). Written a few times a second at most; events and the end are written at once."""

    def __init__(self, path: Path, action: str, folder: Path | str = "", clock=time.time):
        self.path, self.clock, self._written = path, clock, 0.0
        self.steps = STEPS[action]
        # The process and the folder let a later start tell a freeze still running from one cut short (recover).
        self.state = {"action": action, "pid": os.getpid(), "folder": str(folder), "steps": [name for name, _ in self.steps], "step": self.steps[0][0], "step_share": 0.0,
                      "percent": 0.0, "done_bytes": 0, "total_bytes": 0, "file": "", "events": [], "started_at": clock(),
                      "updated_at": clock(), "finished": False, "ok": None}
        self.event("start")

    def _percent(self) -> float:
        before, total = 0, sum(weight for _, weight in self.steps)
        for name, weight in self.steps:
            if name == self.state["step"]:
                return round(100 * (before + weight * self.state["step_share"]) / total, 2)
            before += weight
        return 100.0

    def total(self, size: int) -> None:
        self.state["total_bytes"] = int(size)
        self.write()

    def step(self, name: str) -> None:
        self.state.update(step=name, step_share=0.0, file="")
        self.state["percent"] = self._percent()
        self.event("step", name=name)

    def advance(self, share: float, done: int | None = None, file: str | None = None) -> None:
        self.state["step_share"] = max(0.0, min(1.0, share))
        self.state["percent"] = self._percent()
        if done is not None:
            self.state["done_bytes"] = int(done)
        if file:
            self.state["file"] = file
        self.write()

    def event(self, kind: str, **values) -> None:
        self.state["events"] = [*self.state["events"], {"at": round(self.clock(), 1), "kind": kind, **values}][-MAX_EVENTS:]
        self.write(force=True)

    def finish(self, ok: bool, **values) -> None:
        if ok:
            self.state.update(step=self.steps[-1][0], step_share=1.0, percent=100.0, done_bytes=self.state["total_bytes"])
        self.state.update(finished=True, ok=ok, file="", cancelled=bool(values.get("cancelled")))
        self.event("done" if ok else "failed", **values)

    def write(self, force: bool = False) -> None:
        now = self.clock()
        if not force and now - self._written < 0.25:
            return
        self._written = now
        self.state["updated_at"] = round(now, 1)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            write_json(self.path, self.state)
        except OSError:
            pass  # the bar is a courtesy: the work goes on without it


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


def _payload_files(folder: Path) -> list[tuple[Path, int]]:
    """The game's own files and their sizes: everything except its log, markers and a deep archive."""
    skip = {*KEEP, *deep_archive_names(folder)}
    return [(p, p.stat().st_size) for p in folder.rglob("*") if p.is_file() and not p.is_symlink()
            and not (p.parent == folder and p.name in skip)]


def _payload_size(folder: Path) -> int:
    return sum(size for _, size in _payload_files(folder))


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
    def __init__(self, storage, logger=None, seven_zip: str | None = None, run=subprocess.run, is_running=running_under, now=time.time,
                 workers: int | None = None):
        self.storage = storage
        self.workers = workers or max(1, min(32, os.cpu_count() or 4))
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

    def orphan_deep(self, app_id: int, name: str = "") -> dict | None:
        """A deep freeze this install has no record of: the folder holds the archive and nothing else to play (another
        copy of Game Access froze it, or the record was lost). Its record is made from the archive so it can be thawed."""
        if self.record(app_id):
            return None
        try:
            folder = self.storage.folder(app_id, name)
        except ValueError:
            return None
        archive = deep_archive(folder)
        if archive is None:
            return None
        try:
            original = self._listed_bytes(self._tool(), archive)
        except Exception:
            original = archive.stat().st_size
        return {"level": "deep", "folder": str(folder), "original_bytes": original, "stored_bytes": archive.stat().st_size, "orphan": True}

    def _save(self, app_id: int, record: dict) -> None:
        self.records.mkdir(parents=True, exist_ok=True)
        write_json(self.records / f"{int(app_id)}.json", record)

    def forget(self, app_id: int) -> None:
        """The game was uninstalled: its record goes too (the archive went with the folder)."""
        (self.records / f"{int(app_id)}.json").unlink(missing_ok=True)

    def is_deep(self, app_id: int, name: str = "") -> bool:
        record = self.record(app_id)
        if record:
            return record.get("level") == "deep"
        try:
            return deep_archive(self.storage.folder(app_id, name)) is not None
        except ValueError:
            return False

    def describe(self, app_id: int, folder: Path, with_sizes: bool = True) -> dict:
        """What the library shows: the level, the real size and what it takes on disk now."""
        record = self.record(app_id)
        if not record and folder.is_dir() and deep_archive(folder) is not None:
            stored = deep_archive(folder).stat().st_size
            return {"frozen": "deep", "frozen_bytes": stored, "original_bytes": stored}
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

    def _stream(self, args: list[str], what: str, progress: FreezeProgress, total: int, cwd: Path | None = None,
                control: FreezeControl | None = None) -> None:
        """Run 7-Zip (below normal priority) with its progress on stdout (-bsp1): every "NN% ... file" it prints moves
        the step and the file. With `control`, a pause suspends 7-Zip where it is and a cancel stops it (FreezeCancelled)."""
        process = subprocess.Popen(args, cwd=str(cwd) if cwd else None, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   creationflags=NO_WINDOW | (0x00004000 if sys.platform == "win32" else 0))
        errors: list[bytes] = []
        reader = threading.Thread(target=lambda: errors.append(process.stderr.read()), daemon=True)
        reader.start()
        stop, stopped = threading.Event(), {"cancelled": False}

        def watch() -> None:
            held = False
            while True:
                if control.cancelled():
                    if held:
                        resume(process.pid)
                    stopped["cancelled"] = True
                    process.kill()
                    return
                if control.paused() != held:
                    held = not held
                    (suspend if held else resume)(process.pid)
                if stop.wait(0.3):
                    break
            if held:
                resume(process.pid)

        watcher = threading.Thread(target=watch, daemon=True) if control else None
        if watcher:
            watcher.start()
        pending = ""
        while chunk := process.stdout.read1(65536):
            pending += chunk.decode("utf-8", "replace")
            *lines, pending = re.split(r"[\r\n\b]+", pending)  # 7-Zip rewrites its line with backspaces
            for line in lines:
                match = SEVEN_ZIP_PROGRESS.match(line)
                if match:
                    share = int(match.group(1)) / 100
                    progress.advance(share, done=int(total * share), file=match.group(2) or None)
        process.wait()
        stop.set()
        if watcher:
            watcher.join()
        reader.join()
        if stopped["cancelled"]:
            raise FreezeCancelled("Cancelado: el juego quedó como estaba.")
        if process.returncode != 0:
            text = b"".join(errors).decode("utf-8", "replace").strip()
            raise RuntimeError(f"{what} terminó con código {process.returncode}: {text[-300:]}")

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
    def _progress(self, app_id: int, action: str, folder: Path) -> FreezeProgress:
        return FreezeProgress(self.records / f"{int(app_id)}.progress.json", action, folder)

    def _control(self, app_id: int) -> FreezeControl:
        return FreezeControl(self.records, app_id)

    def _parallel(self, folder: Path, files: list[tuple[Path, int]], work, progress: FreezeProgress | None, report_stored: bool,
                  control: FreezeControl | None = None) -> list[Path]:
        """`work` (compress or uncompress one file) on every file, on all cores at once, biggest files first so the
        threads end together. Before each file the work waits while paused and stops when cancelled (FreezeCancelled:
        the files started go on to their end, the rest are not touched). Returns the files Windows refused (in use,
        read-only...); the others are done."""
        total = sum(size for _, size in files) or 1
        done, refused = 0, []

        def task(path: Path) -> int:
            if control:
                control.checkpoint()
            return work(path)

        with ThreadPoolExecutor(self.workers) as pool:
            jobs = {pool.submit(task, path): (path, size) for path, size in sorted(files, key=lambda item: -item[1])}
            try:
                for job in as_completed(jobs):
                    path, size = jobs[job]
                    code = job.result()
                    done += size
                    name = str(path.relative_to(folder))
                    if progress is None:
                        continue
                    if code:
                        refused.append(path)
                        progress.event("skipped", name=name, code=code)
                    elif size >= BIG_FILE:
                        progress.event("file", name=name, bytes=size, **({"stored": on_disk(path)} if report_stored else {}))
                    progress.advance(done / total, done=done, file=name)
            except FreezeCancelled:
                for job in jobs:
                    job.cancel()
                raise
        return refused

    def freeze(self, app_id: int, name: str) -> dict:
        """Windows compression: playable without thawing. Every core compresses its own files at the same time; files
        already compressed (a freeze cut short) are skipped. Cancelled, what was compressed is decompressed again."""
        folder = self._target(app_id, name)
        if self.is_deep(app_id):
            raise ValueError("El juego ya está en congelado profundo.")
        control = self._control(app_id)
        control.acquire("freeze")
        progress = self._progress(app_id, "freeze", folder)
        started = self.now()
        self._note(folder, f"inicio: congelado (compresión de Windows, {self.workers} hilos)")
        lower_priority()
        files: list[tuple[Path, int]] = []
        try:
            files = _payload_files(folder)
            original = sum(size for _, size in files)
            progress.total(original)
            progress.event("files", count=len(files), bytes=original)
            progress.step("compress")
            if wof.available():
                progress.event("threads", count=self.workers)
                refused = self._parallel(folder, files, lambda path: 0 if wof.is_compressed(path) else wof.compress(path), progress,
                                         report_stored=True, control=control)
                if refused:
                    self.log and self.log.info("%s: %s files left uncompressed (in use or protected)", folder.name, len(refused))
            else:
                # /i keeps going past files in use; Windows skips files that would not shrink.
                self._exec(["compact.exe", "/c", f"/s:{folder}", "/i", "/q", "/exe:LZX"], "La compresión de Windows")
            stored = folder_on_disk(folder)
            record = {"level": "freeze", "folder": str(folder), "original_bytes": original, "stored_bytes": stored,
                      "frozen_at": datetime.now().isoformat(timespec="seconds")}
            self._save(app_id, record)
            seconds = self.now() - started
            self._note(folder, f"congelado (compresión de Windows, {self.workers} hilos): {original / 1e9:.1f} GB -> {stored / 1e9:.1f} GB en {seconds:.0f} s")
            progress.finish(True, original=original, stored=stored, seconds=round(seconds))
            return record
        except FreezeCancelled:
            # Back as it was: every file compressed so far is decompressed (a second or two).
            self._parallel(folder, files, wof.uncompress, None, report_stored=False)
            self._note(folder, f"cancelado al {progress.state['percent']:.0f} %: se descomprimió lo hecho")
            progress.finish(False, cancelled=True)
            raise
        except BaseException as error:
            progress.finish(False, error=str(error))
            self._note(folder, f"falló: {error}")
            raise
        finally:
            control.release()

    def deep_freeze(self, app_id: int, name: str) -> dict:
        """One 7-Zip archive inside the game folder; the files are removed only after the archive checks out.
        Cancelled while compressing or checking, the half-made archive is deleted (the game was never touched); the
        last step (removing the files) is not cancelled: it takes seconds and the archive is already complete."""
        folder = self._target(app_id, name)
        if self.is_deep(app_id):
            raise ValueError("El juego ya está en congelado profundo.")
        tool = self._tool()
        control = self._control(app_id)
        control.acquire("deep")
        progress = self._progress(app_id, "deep", folder)
        started = self.now()
        self._note(folder, f"inicio: congelado profundo (7-Zip, {self.workers} hilos)")
        archive = deep_archive_for(folder)
        partial = archive.with_name(archive.name + ".tmp")
        try:
            files = _payload_files(folder)
            original = sum(size for _, size in files)
            progress.total(original)
            progress.event("files", count=len(files), bytes=original)
            free = shutil.disk_usage(folder).free
            if free < original:
                raise ValueError(f"No hay espacio para el archivo temporal: hacen falta {original / 1e9:.1f} GB libres y hay {free / 1e9:.1f} GB.")
            partial.unlink(missing_ok=True)
            excluded = [f"-x!{kept}" for kept in (*KEEP, *deep_archive_names(folder))]  # top level only
            progress.step("compress")
            progress.event("threads", count=self.workers)
            try:
                self._stream([tool, "a", "-t7z", "-m0=lzma2", f"-mx{DEEP_LEVEL}", f"-mmt{self.workers}", "-y", "-sccUTF-8", "-bso0", "-bsp1",
                              str(partial), "*", *excluded], "7-Zip", progress, original, cwd=folder, control=control)
                progress.event("archived", bytes=partial.stat().st_size)
                progress.step("verify")
                self._stream([tool, "t", "-y", "-sccUTF-8", "-bso0", "-bsp1", str(partial)], "La prueba del archivo", progress, original, control=control)
                listed = self._listed_bytes(tool, partial)
                if listed != original:
                    raise RuntimeError(f"El archivo guarda {listed} bytes y el juego tiene {original}: no se borra nada.")
                progress.event("verified")
            except BaseException:
                partial.unlink(missing_ok=True)
                raise
            os.replace(partial, archive)
            record = {"level": "deep", "folder": str(folder), "original_bytes": original, "stored_bytes": archive.stat().st_size,
                      "frozen_at": datetime.now().isoformat(timespec="seconds"), "phase": "clearing"}
            self._save(app_id, record)  # from here a thaw restores the game, whatever is left in the folder
            progress.step("clear")
            self._clear(folder, progress)
            record.pop("phase")
            record["stored_bytes"] = folder_on_disk(folder)
            self._save(app_id, record)
            seconds = self.now() - started
            self._note(folder, f"congelado profundo (7-Zip, {self.workers} hilos): {original / 1e9:.1f} GB -> {record['stored_bytes'] / 1e9:.1f} GB en {seconds:.0f} s")
            progress.finish(True, original=original, stored=record["stored_bytes"], seconds=round(seconds))
            return record
        except FreezeCancelled:
            self._note(folder, f"cancelado al {progress.state['percent']:.0f} %: se descartó el archivo a medias, el juego no se tocó")
            progress.finish(False, cancelled=True)
            raise
        except BaseException as error:
            progress.finish(False, error=str(error))
            self._note(folder, f"falló: {error}")
            raise
        finally:
            control.release()

    @staticmethod
    def _clear(folder: Path, progress: FreezeProgress | None = None) -> None:
        """Remove the game's own files once its deep archive is complete (the log, the markers and the archive stay)."""
        items = [item for item in folder.iterdir() if item.name not in (*KEEP, *deep_archive_names(folder))]
        for index, item in enumerate(items, 1):
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()
            if progress:
                progress.advance(index / len(items), file=item.name)

    def thaw(self, app_id: int, name: str, priority: bool = False) -> dict:
        """Undo either level. A deep freeze needs the game's full size free on the disk. Cancelled, the game stays
        frozen as it was (a deep thaw removes what it had extracted; the archive is never touched before the end).
        `priority`: the player is waiting (Play on a deep-frozen game): it goes ahead of the work holding the lock."""
        record = self.record(app_id) or self.orphan_deep(app_id, name)
        if not record:
            folder = self._target(app_id, name)
            if not compressed_sizes(folder):
                return {"thawed": False}
            record = {"level": "freeze"}  # compressed without a record: Windows decompression, like a normal freeze
        else:
            folder = self._target(app_id, name)
        deep = record["level"] == "deep"
        control = self._control(app_id)
        control.acquire("thaw-deep" if deep else "thaw", priority=priority)
        progress = self._progress(app_id, "thaw-deep" if deep else "thaw", folder)
        started = self.now()
        self._note(folder, f"inicio: descongelado ({'congelado profundo' if deep else 'compresión de Windows'})")
        lower_priority()
        try:
            if deep:
                archive = deep_archive(folder)
                if archive is None:
                    raise RuntimeError("Falta el archivo del congelado profundo: el juego no se puede recuperar desde acá.")
                if record.get("phase") == "clearing":
                    self._clear(folder)    # a deep freeze cut short while removing the files: its archive is complete
                needed = record["original_bytes"] - _payload_size(folder)
                free = shutil.disk_usage(folder).free
                if free < needed:
                    raise ValueError(f"No hay espacio para descongelar: hacen falta {needed / 1e9:.1f} GB libres y hay {free / 1e9:.1f} GB.")
                progress.total(record["original_bytes"])
                progress.event("threads", count=self.workers)
                self._stream([self._tool(), "x", "-y", "-aoa", f"-mmt{self.workers}", "-sccUTF-8", "-bso0", "-bsp1", f"-o{folder}", str(archive)],
                             "7-Zip", progress, record["original_bytes"], control=None if priority else control)
                progress.step("check")
                restored = _payload_size(folder)
                if restored != record["original_bytes"]:
                    raise RuntimeError(f"Se recuperaron {restored} bytes de {record['original_bytes']}: el archivo se conserva.")
                archive.unlink()
                progress.advance(1)
            else:
                files = _payload_files(folder)
                progress.total(sum(size for _, size in files))
                if wof.available():
                    progress.event("threads", count=self.workers)
                    refused = self._parallel(folder, files, wof.uncompress, progress, report_stored=False, control=None if priority else control)
                else:
                    refused = files
                if refused:
                    # What could not be opened for writing (read-only files...) goes through compact, which handles it.
                    self._exec(["compact.exe", "/u", f"/s:{folder}", "/i", "/q", "/exe"], "La descompresión de Windows")
            self.forget(app_id)
            seconds = self.now() - started
            self._note(folder, f"descongelado ({'congelado profundo' if deep else 'compresión de Windows'}) en {seconds:.0f} s")
            progress.finish(True, seconds=round(seconds))
            return {"thawed": True, "level": record["level"]}
        except FreezeCancelled:
            if deep:
                self._clear(folder)   # what had been extracted goes: the archive is still the game
            elif self.record(app_id):
                self._save(app_id, {**record, "stored_bytes": folder_on_disk(folder)})
            self._note(folder, f"descongelado cancelado al {progress.state['percent']:.0f} %: el juego sigue congelado")
            progress.finish(False, cancelled=True)
            raise
        except BaseException as error:
            progress.finish(False, error=str(error))
            self._note(folder, f"falló: {error}")
            raise
        finally:
            control.release()

    # -- after a closed app or a crash ----------------------------------------------------------------
    def recover(self) -> list[dict]:
        """Each freeze or thaw that never ended and whose process is gone is put back in a safe state, said in its
        log, and reported (its progress is marked as ended, so it is reported once):

            freeze      every file is either compressed or not, the game plays: it can go on ("resumable") or be undone
            deep        cut while compressing or checking: the half-made archive goes, the game was never touched
                        ("discarded"); cut while removing the files: the archive is complete, the removal ends ("completed")
            thaw-deep   what had been extracted goes, the archive is still the game ("retry")
            thaw        part of the files is back to normal, the game plays ("retry")
            move        cut while copying: the game stays linked where it was and the half-made copy waits to go on
                        ("resumable"); cut after the copy: the game is in the library already ("completed")

        A freeze whose process is still running (the app was closed, the work went on) is reported as "running"."""
        found: list[dict] = []
        if not self.records.is_dir():
            return found
        for path in sorted(self.records.glob("*.progress.json")):
            try:
                state = json.loads(path.read_text(encoding="utf-8"))
                app_id = int(path.name.split(".")[0])
            except (OSError, ValueError):
                continue
            if state.get("finished"):
                continue
            action, percent = state.get("action", ""), float(state.get("percent") or 0)
            entry = {"app_id": app_id, "action": action, "percent": percent}
            if pid_alive(state.get("pid")):
                found.append({**entry, "outcome": "running"})
                continue
            folder = Path(state.get("folder") or "")
            try:
                if action == "freeze":
                    entry["outcome"] = "resumable"
                elif action == "deep":
                    record = self.record(app_id)
                    if record and record.get("phase") == "clearing" and deep_archive(folder) is not None:
                        self._clear(folder)
                        record.pop("phase")
                        record["stored_bytes"] = folder_on_disk(folder)
                        self._save(app_id, record)
                        entry["outcome"] = "completed"
                    else:
                        for name in deep_archive_names(folder):
                            if name.endswith(".tmp"):
                                (folder / name).unlink(missing_ok=True)
                        entry["outcome"] = "discarded"
                elif action == "move":
                    source, target = Path(state.get("source") or ""), Path(state.get("target") or "")
                    name = state.get("name") or f"#{app_id}"
                    if state.get("source") and source.is_dir() and state.get("step") == "move":
                        # Cut while copying: the game is played from where it was meanwhile; the copy waits for "Continue".
                        self.storage.linked.link(app_id, name, str(source), "folder", state.get("executable") or "")
                        state["resumable"] = bool(state.get("target")) and target.is_dir()
                        entry["outcome"] = "resumable" if state["resumable"] else "restored"
                        folder = source
                    else:
                        # Cut after the copy: the game is in the games folder; what is left of the original goes.
                        if state.get("source") and source.is_dir():
                            shutil.rmtree(source, ignore_errors=True)
                        if target.is_dir():
                            self.storage.register(app_id, name)
                        entry["outcome"] = "completed"
                        folder = target
                elif action == "thaw-deep":
                    if deep_archive(folder) is not None:
                        self._clear(folder)
                    entry["outcome"] = "retry"
                else:
                    entry["outcome"] = "retry"
            except OSError as error:
                entry.update(outcome="failed", error=str(error))
            if folder.is_dir():
                journal.note(folder, "move" if action == "move" else "freeze", f"interrumpido al {percent:.0f} % (la app se cerró): {entry['outcome']}")
            state.update(finished=True, ok=False, interrupted=True)
            write_json(path, state)
            found.append(entry)
        return found

    def ensure_thawed(self, app_id: int, name: str) -> bool:
        """Before Play, repair or analysis: a deep-frozen game is brought back. Windows compression needs nothing."""
        if not self.is_deep(app_id, name):
            return False
        self.thaw(app_id, name, priority=True)
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
                except FreezeBusy:
                    return done        # another freeze or thaw is going on: next time
                except (OSError, ValueError, RuntimeError) as error:
                    done.append({"app_id": app_id, "ok": False, "level": wanted, "error": str(error)})
        return done
