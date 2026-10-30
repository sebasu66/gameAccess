"""Moving a game folder into the library with its progress, as a freeze shows its own (freezer.FreezeProgress).

On the same disk the folder is only renamed: instant, nothing to show. To another disk every file is copied in pieces,
the bytes written going to the progress file a few times a second (the desktop draws it in the game's row), and the
original folder goes only once every file was copied. A cancel or a pause from the app (freeze_control) is looked at
between two pieces: cancelled, the half-made copy goes and the original was never touched.
"""
from __future__ import annotations
import os
import shutil
import time
from pathlib import Path

CHUNK = 8 * 1024 * 1024
# A file this big gets its own line in the game's log when it is done (smaller ones would flood it).
BIG_FILE = 512 * 1024 * 1024


class _Silent:
    """No progress file (a move asked by another path, or a test)."""
    def total(self, size): pass
    def step(self, name): pass
    def advance(self, share, done=None, file=None): pass
    def event(self, kind, **values): pass


def move_folder(source: Path, target: Path, progress=None, checkpoint=lambda: None, clock=time.time) -> dict:
    """Move `source` to `target` (which must not exist). Returns {"renamed": bool, "bytes": int, "files": int}."""
    progress = progress or _Silent()
    source, target = Path(source), Path(target)
    files = [path for path in source.rglob("*") if path.is_file() and not path.is_symlink()]
    total = sum(path.stat().st_size for path in files)
    progress.total(total)
    progress.event("files", count=len(files), bytes=total)
    progress.step("move")
    try:
        os.rename(source, target)
        progress.event("renamed")
        progress.advance(1.0, total)
        return {"renamed": True, "bytes": total, "files": len(files)}
    except OSError:
        pass  # another disk (or a file in use): copied piece by piece below
    done = 0
    started = clock()
    try:
        for directory in [source, *(path for path in source.rglob("*") if path.is_dir() and not path.is_symlink())]:
            (target / directory.relative_to(source)).mkdir(parents=True, exist_ok=True)
        for path in files:
            relative = path.relative_to(source)
            destination = target / relative
            with open(path, "rb") as reader, open(destination, "wb") as writer:
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
    except BaseException:
        shutil.rmtree(target, ignore_errors=True)   # the original is untouched: only the half-made copy goes
        raise
    progress.event("copied", bytes=done, seconds=round(clock() - started, 1))
    progress.step("clear")
    try:
        shutil.rmtree(source)
    except OSError as error:
        # Every file is in the library already: a file the original folder keeps open is only a leftover to delete.
        progress.event("leftover", folder=str(source), error=str(error))
    progress.advance(1.0, done)
    return {"renamed": False, "bytes": done, "files": len(files)}
