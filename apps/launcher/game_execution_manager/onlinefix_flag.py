"""Keeps OnlineFix from showing its first-run dialog (and opening a web page) on every Play.

After that dialog, OnlineFix writes `[Hashes] 1337=` in OnlineFix.ini so it is not shown again. The value is
different for every game, and Play brings the dialog back: the fix archive re-applied before Play recreates the
file, and the provider profile sets one fixed value for every game. So GameAccess learns the value the fix wrote
after a run and puts it back once the preparation before Play is done. The first Play of a game still shows it.

`1337` goes with `[Hashes] 0=`, which never changes for a given fix and differs between games: a learned value
is only put back while `0=` is the one it was learned with (a new fix version learns its own)."""
from __future__ import annotations
import json
import re
from pathlib import Path
from atomic_json import write_json

SECTION, KEY, BASE_KEY = "Hashes", "1337", "0"
FILE_NAME = "onlinefix.ini"


def flag_files(folder: Path) -> list[Path]:
    root = Path(folder).resolve()
    return [path for path in root.rglob("*") if path.name.lower() == FILE_NAME and path.is_file()
            and not path.is_symlink() and path.resolve().is_relative_to(root)]


def _section(content: str) -> tuple[int, int] | None:
    match = re.search(r"(?im)^\[" + re.escape(SECTION) + r"\]\s*$", content)
    if not match:
        return None
    end = re.search(r"(?m)^\[", content[match.end():])
    return match.end(), match.end() + end.start() if end else len(content)


def read_flag(path: Path, key: str = KEY) -> str | None:
    content = path.read_text(encoding="utf-8", errors="ignore")
    bounds = _section(content)
    if bounds is None:
        return None
    found = re.search(r"(?im)^" + re.escape(key) + r"[ \t]*=[ \t]*(\S*)[ \t]*$", content[bounds[0]:bounds[1]])
    return found.group(1) if found and found.group(1) else None


def write_flag(path: Path, value: str) -> None:
    content = path.read_text(encoding="utf-8", errors="ignore")
    bounds = _section(content)
    line = f"{KEY}={value}"
    if bounds is None:
        updated = content + ("" if content.endswith("\n") or not content else "\n") + f"[{SECTION}]\n{line}\n"
    else:
        start, end = bounds
        body = content[start:end]
        entry = re.compile(r"(?im)^" + re.escape(KEY) + r"[ \t]*=.*$")
        body = entry.sub(lambda _: line, body, count=1) if entry.search(body) else "\n" + line + body
        updated = content[:start] + body + content[end:]
    if updated != content:
        path.write_text(updated, encoding="utf-8")


class OnlineFixFlag:
    """Per game: for each OnlineFix.ini (by its path inside the game folder), the value GameAccess left before the
    last Play ("written") and the one OnlineFix wrote after its dialog ("seen")."""

    def __init__(self, state_path: Path, logger=None):
        self.state_path = Path(state_path)
        self.logger = logger

    def _load(self) -> dict:
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _log(self, message: str, *args) -> None:
        if self.logger is not None:
            self.logger.info(message, *args)

    def learn(self, folder: Path) -> None:
        """Before the fix is re-applied: a value that changed since the last Play was written by OnlineFix."""
        state = self._load()
        changed = False
        for path in flag_files(folder):
            name = path.relative_to(Path(folder).resolve()).as_posix()
            entry = state.setdefault(name, {})
            current = read_flag(path)
            # Also with no record yet (a game played before this existed): a wrong guess costs one dialog,
            # after which OnlineFix rewrites the value and it is learned again.
            if current and current != entry.get("written") and current != entry.get("seen"):
                entry["seen"], entry["base"] = current, read_flag(path, BASE_KEY) or ""
                changed = True
                self._log("OnlineFix: learned the first-run value of %s", name)
        if changed:
            write_json(self.state_path, state)

    def restore(self, folder: Path) -> None:
        """After the preparation before Play: put the learned value back and remember what the file holds now."""
        state = self._load()
        for path in flag_files(folder):
            name = path.relative_to(Path(folder).resolve()).as_posix()
            entry = state.setdefault(name, {})
            seen = entry.get("seen")
            if seen and entry.get("base", "") != (read_flag(path, BASE_KEY) or ""):
                entry.pop("seen", None)  # another version of the fix: its value has to be learned again
                seen = None
                self._log("OnlineFix: %s comes from another fix version; its first-run value is learned again", name)
            if seen and read_flag(path) != seen:
                write_flag(path, seen)
                self._log("OnlineFix: restored the first-run value of %s (no dialog)", name)
            entry["written"] = read_flag(path) or ""
        if state:
            write_json(self.state_path, state)
