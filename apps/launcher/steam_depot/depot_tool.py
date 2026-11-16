"""DepotDownloader (SteamRE, GPL-2.0) as the tool that brings a free Steam game from Steam's own servers.

Game Access only runs it for games and demos Steam gives away (free to play, free demos): the files come from Steam's
CDN with the player's own Steam session, and the game ends in the player's Steam library, where Steam adopts it
(steam_library_handoff.py). Game Access never reads, asks for or keeps a password: DepotDownloader signs in with the
token it saved itself for a remembered account, or with a QR code the player scans in the Steam app on the phone.

This module owns the tool (found, or downloaded once from the official release and checked against a pinned hash),
the command line, and reading its output. It does not choose libraries nor talk to the queue.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

TOOL_VERSION = "3.4.0"
TOOL_URL = f"https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_{TOOL_VERSION}/DepotDownloader-windows-x64.zip"
# The executable of the official 3.4.0 release (v3.4.0+c553ef4d), measured on 2026-11-12. Anything else is refused.
TOOL_SHA256 = "6281279efce8f1e20db9532a58e42382f81afb9e3827a8b965ffcb43fbe4531f"
# Distinct LogonIDs let several DepotDownloader run at once with one account ("GA" in the high bits).
LOGIN_ID_BASE = 0x47410000


def tools_root() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "GameAccess" / "tools" / f"depotdownloader-{TOOL_VERSION}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_tool(root: Path | None = None) -> Path | None:
    """The checked executable, or None when it is missing or is not the pinned release."""
    exe = (root or tools_root()) / "DepotDownloader.exe"
    return exe if exe.is_file() and _sha256(exe) == TOOL_SHA256 else None


def ensure_tool(root: Path | None = None, fetch=urllib.request.urlopen) -> Path:
    """The executable, downloading the official release the first time. A file with another hash is not run."""
    root = root or tools_root()
    found = find_tool(root)
    if found:
        return found
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ga-depot-") as work:
        archive = Path(work) / "depot.zip"
        request = urllib.request.Request(TOOL_URL, headers={"User-Agent": "GameAccess"})
        with fetch(request, timeout=120) as response, open(archive, "wb") as out:
            shutil.copyfileobj(response, out)
        with zipfile.ZipFile(archive) as bundle:
            member = next((name for name in bundle.namelist() if name.lower().endswith("depotdownloader.exe")), None)
            if member is None:
                raise RuntimeError("DepotDownloader.exe is not in the official release")
            staged = Path(work) / "DepotDownloader.exe"
            with bundle.open(member) as source, open(staged, "wb") as out:
                shutil.copyfileobj(source, out)
        if _sha256(staged) != TOOL_SHA256:
            raise RuntimeError("DepotDownloader does not match the pinned release: it was not installed")
        shutil.move(str(staged), root / "DepotDownloader.exe")
    return root / "DepotDownloader.exe"


def command(tool: Path, app_id: int, target: Path, *, account: str | None, qr: bool, login_id: int, max_downloads: int = 8) -> list[str]:
    """The command line. With an account it signs in with the token DepotDownloader remembered for it; `qr` asks for
    a new one with a QR code (and remembers it). Without either it tries the anonymous account."""
    argv = [str(tool), "-app", str(app_id), "-dir", str(target), "-os", "windows", "-osarch", "64",
            "-max-downloads", str(max_downloads), "-loginid", str(login_id), "-validate"]
    if qr:
        argv += ["-qr", "-remember-password"] + (["-username", account] if account else [])
    elif account:
        argv += ["-username", account, "-remember-password"]
    return argv


# What DepotDownloader writes, as of 3.4.0.
_PROGRESS = re.compile(r"^\s*(\d{1,3}(?:\.\d+)?)%\s+(.+?)\s*$")
_TOTAL = re.compile(r"Total downloaded:\s*(\d+)\s*bytes", re.I)
_PASSWORD = re.compile(r"enter account password", re.I)
_QR_START = re.compile(r"scan.*qr code|qr code.*steam mobile app|use the steam mobile app", re.I)
_NO_ACCESS = re.compile(r"is not available from this account|no subscription|access denied|not owned", re.I)
_AUTH_FAILED = re.compile(r"invalid ?password|access token was rejected|expired|login key.*invalid|unable to (log ?in|authenticate)|InvalidPassword|AccessDenied", re.I)
_NO_SPACE = re.compile(r"not enough (disk )?space|disk full|there is not enough space", re.I)
_QR_CHARS = re.compile(r"^[\s█▀▄▌▐░▒▓■□#]+$")


@dataclass
class DepotState:
    """What the output said so far: the last percent and file, the QR to show, and why it stopped if it did."""
    percent: float = 0.0
    file: str = ""
    total_bytes: int | None = None
    needs_login: bool = False
    qr: list[str] = field(default_factory=list)
    reading_qr: bool = False
    failure: str | None = None  # "no_access", "auth", "no_space"

    def feed(self, line: str) -> str | None:
        """Takes one line; returns what changed ("progress", "qr", "login", "failure", "done") or None."""
        text = line.rstrip("\r\n")
        if self.reading_qr:
            if text and _QR_CHARS.match(text):
                self.qr.append(text)
                return None
            if self.qr:
                self.reading_qr = False
                return "qr"
        if _QR_START.search(text):
            self.reading_qr, self.qr = True, []
            return None
        if _PASSWORD.search(text):
            self.needs_login = True
            return "login"
        for pattern, reason in ((_NO_ACCESS, "no_access"), (_NO_SPACE, "no_space"), (_AUTH_FAILED, "auth")):
            if pattern.search(text):
                self.failure = self.failure or reason
                return "failure"
        total = _TOTAL.search(text)
        if total:
            self.total_bytes = int(total.group(1))
            return "done"
        progress = _PROGRESS.match(text)
        if progress:
            self.percent = min(100.0, float(progress.group(1)))
            self.file = progress.group(2).strip()
            return "progress"
        return None
