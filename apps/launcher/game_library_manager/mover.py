"""Moving a game folder into the library with its progress, as a freeze shows its own (freezer.FreezeProgress).

On the same disk the folder is only renamed: instant, nothing to show. To another disk every file is copied in pieces,
the bytes written going to the progress file a few times a second (the desktop draws it in the game's row), and the
original folder goes only once every file was copied. A cancel or a pause from the app (freeze_control) is looked at
between two pieces: cancelled, the half-made copy goes and the original was never touched.

A copy cut short any other way (the app or the computer went off, a disk error) keeps what it copied: `resume=True`
goes on from there. A file already copied whole (same size and date) is skipped; the file that was being copied goes
on from where it stopped once its last piece is checked against the original, else it is copied again.
"""
from __future__ import annotations
import os
import shutil
import time
from pathlib import Path

from .freeze_control import FreezeCancelled

CHUNK = 8 * 1024 * 1024
# A file this big gets its own line in the game's log when it is done (smaller ones would flood it).
BIG_FILE = 512 * 1024 * 1024
# How much of a half-copied file is compared with the original before going on from its end.
OVERLAP = 16 * 1024 * 1024


class _Silent:
    """No progress file (a move asked by another path, or a test)."""
    def total(self, size): pass
    def step(self, name): pass
    def advance(self, share, done=None, file=None): pass
    def event(self, kind, **values): pass


def _same_bytes(a, b, offset: int, length: int) -> bool:
    a.seek(offset)
    b.seek(offset)
    while length > 0:
        size = min(CHUNK, length)
        if a.read(size) != b.read(size):
            return False
        length -= size
    return True


def resume_offset(source: Path, copy: Path) -> int:
    """Where to go on copying `source` into the half-made `copy`: its end when its last piece matches, else 0."""
    have, size = copy.stat().st_size, source.stat().st_size
    if have == 0 or have > size:
        return 0
    overlap = min(have, OVERLAP)
    with open(source, "rb") as original, open(copy, "rb") as copied:
        return have if _same_bytes(original, copied, have - overlap, overlap) else 0


def _copied_whole(source: Path, copy: Path) -> bool:
    try:
        a, b = source.stat(), copy.stat()
    except OSError:
        return False
    return a.st_size == b.st_size and abs(a.st_mtime - b.st_mtime) < 2


def move_folder(source: Path, target: Path, progress=None, checkpoint=lambda: None, clock=time.time, resume: bool = False) -> dict:
    """Move `source` to `target`. `target` must not exist, unless `resume` (a copy cut short to go on with).
    Returns {"renamed": bool, "bytes": int, "files": int, "resumed_bytes": int}."""
    progress = progress or _Silent()
    source, target = Path(source), Path(target)
    files = [path for path in source.rglob("*") if path.is_file() and not path.is_symlink()]
    total = sum(path.stat().st_size for path in files)
    progress.total(total)
    progress.event("files", count=len(files), bytes=total)
    progress.step("move")
    resuming = resume and target.is_dir()
    if not resuming:
        try:
            os.rename(source, target)
            progress.event("renamed")
            progress.advance(1.0, total)
            return {"renamed": True, "bytes": total, "files": len(files), "resumed_bytes": 0}
        except OSError:
            pass  # another disk (or a file in use): copied piece by piece below
    done = kept = 0
    started = clock()
    try:
        for directory in [source, *(path for path in source.rglob("*") if path.is_dir() and not path.is_symlink())]:
            (target / directory.relative_to(source)).mkdir(parents=True, exist_ok=True)
        for path in files:
            relative = path.relative_to(source)
            destination = target / relative
            start = 0
            if resuming and destination.is_file():
                if _copied_whole(path, destination):
                    done += path.stat().st_size
                    kept += path.stat().st_size
                    progress.advance(done / total if total else 1.0, done, str(relative))
                    continue
                start = resume_offset(path, destination)
            with open(path, "rb") as reader, open(destination, "r+b" if start else "wb") as writer:
                if start:
                    reader.seek(start)
                    writer.seek(start)
                    writer.truncate()
                    done += start
                    kept += start
                while True:
                    checkpoint()
                    piece = reader.read(CHUNK)
                    if not piece:
                        break
                    writer.write(piece)
                    done += len(piece)
                    progress.advance(done / total if total else 1.0, done, str(relative))
            shutil.copystat(path, destination, follow_symlinks=False)
            if path.stat().st_size >= BIG_FILE:
                progress.event("file", name=str(relative), bytes=path.stat().st_size)
    except FreezeCancelled:
        shutil.rmtree(target, ignore_errors=True)   # cancelled on purpose: the half-made copy goes, the original is untouched
        raise
    if kept:
        progress.event("resumed", bytes=kept)
    progress.event("copied", bytes=done, seconds=round(clock() - started, 1))
    progress.step("clear")
    try:
        shutil.rmtree(source)
    except OSError as error:
        # Every file is in the library already: a file the original folder keeps open is only a leftover to delete.
        progress.event("leftover", folder=str(source), error=str(error))
    progress.advance(1.0, done)
    return {"renamed": False, "bytes": done, "files": len(files), "resumed_bytes": kept}
