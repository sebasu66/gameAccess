"""Small human-readable log kept INSIDE each game folder: every step from download to each Play."""
from __future__ import annotations
import time
from pathlib import Path

JOURNAL_FILE = "gameaccess-log.txt"
MAX_BYTES = 256 * 1024

def note(folder, step: str, detail: str = "") -> None:
    """Append '2026-10-17 09:54:01 | step | detail'. Never raises: logging must not break a download or a launch."""
    try:
        root = Path(folder)
        if not root.is_dir():
            return
        path = root / JOURNAL_FILE
        if path.is_file() and path.stat().st_size > MAX_BYTES:
            tail = path.read_text(encoding="utf-8", errors="replace")[-(MAX_BYTES // 2):]
            path.write_text(tail[tail.find("\n") + 1:], encoding="utf-8")
        line = " | ".join(part.replace("\r", " ").replace("\n", " ")[:600] for part in (time.strftime("%Y-%m-%d %H:%M:%S"), step, detail) if part is not None)
        with path.open("a", encoding="utf-8") as file:
            file.write(line + "\n")
    except OSError:
        pass

def read(folder, max_chars: int = 60000) -> str:
    path = Path(folder) / JOURNAL_FILE
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[-max_chars:]

def last(folder, step: str) -> str:
    """Detail of the most recent journal line for `step` ('' if none)."""
    for line in reversed(read(folder).splitlines()):
        parts = line.split(" | ", 2)
        if len(parts) == 3 and parts[1] == step:
            return parts[2]
    return ""
