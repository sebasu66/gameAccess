"""Install from the website (vault/Instalador web.md): the page is the installer's screen.

The page asks for a session and copies a one-line command with its code. The player pastes it in Win + R; PowerShell
(signed by Microsoft) fetches the script (web_install.ps1, open in this repository) from GET /i/<code>, and the script
reports each step back here. The page polls the session and shows the steps as they happen.

The script installs only the release named here, verified against its SHA-256: the latest GitHub release's
`-setup.exe` and the digest GitHub publishes for it, or, for tests, GAMEACCESS_WEB_INSTALL_URL with
GAMEACCESS_WEB_INSTALL_SHA256 and GAMEACCESS_WEB_INSTALL_VERSION. Without a digest nothing is offered. Only for local
tests (tools/web-install/serve-local.ps1), GAMEACCESS_WEB_INSTALL_FILES names a folder served at /setup/<name>.

Sessions live in memory for 30 minutes: they hold only the steps and what the script says about them (no installation
id, no user name). GAMEACCESS_PUBLIC_API_URL is the address written in the command (default: the Render service).
"""
from __future__ import annotations

import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

router = APIRouter()

DEFAULT_PUBLIC_API = "https://gameaccess-api-dev.onrender.com"
RELEASES_URL = "https://api.github.com/repos/sebasu66/gameAccess/releases/latest"
SCRIPT = Path(__file__).with_name("web_install.ps1")
# No 0/O or 1/I: the code is read on screen.
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
SESSION_SECONDS = 30 * 60
MAX_SESSIONS = 2000
MAX_EVENTS = 300
SESSIONS_PER_HOUR = 30
RELEASE_SECONDS = 10 * 60
STEPS = ("connected", "windows", "smartapp", "webview", "steam", "download", "verify", "install", "open")
_CODE = re.compile(rf"^[{ALPHABET}]{{{CODE_LENGTH}}}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_FILE = re.compile(r"^[\w.\-]+\.exe$")

_sessions: dict[str, dict] = {}
_created: dict[str, list[float]] = {}
_release: dict = {}
_lock = threading.Lock()


class InstallEvent(BaseModel):
    step: Literal["connected", "windows", "smartapp", "webview", "steam", "download", "verify", "install", "open"]
    state: Literal["running", "ok", "skip", "error"]
    # A short reason the page translates (uac_declined, sac_on, ...) or a number of megabytes; never free text.
    detail: str = Field(default="", max_length=120)
    progress: Optional[int] = Field(default=None, ge=0, le=100)


def public_api_url() -> str:
    return os.environ.get("GAMEACCESS_PUBLIC_API_URL", DEFAULT_PUBLIC_API).rstrip("/")


def command_for(code: str) -> str:
    return f'powershell -nop -c "irm {public_api_url()}/i/{code}|iex"'


def _address(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def _prune(now: float) -> None:
    for code in [code for code, row in _sessions.items() if now - row["created"] > SESSION_SECONDS]:
        del _sessions[code]


def latest_release() -> dict:
    """{url, sha256, version} of what the script installs, or {} when nothing verifiable is published."""
    override = os.environ.get("GAMEACCESS_WEB_INSTALL_URL", "").strip()
    if override:
        sha256 = os.environ.get("GAMEACCESS_WEB_INSTALL_SHA256", "").strip().lower()
        if not _SHA256.match(sha256):
            return {}
        return {"url": override, "sha256": sha256, "version": os.environ.get("GAMEACCESS_WEB_INSTALL_VERSION", "").strip()}
    now = time.time()
    with _lock:
        if _release and now - _release["at"] < RELEASE_SECONDS:
            return _release["value"]
    value: dict = {}
    try:
        response = httpx.get(RELEASES_URL, headers={"Accept": "application/vnd.github+json"}, timeout=10)
        response.raise_for_status()
        release = response.json()
        for asset in release.get("assets") or []:
            name = str(asset.get("name") or "")
            digest = str(asset.get("digest") or "")
            if name.lower().endswith("-setup.exe") and digest.startswith("sha256:") and _SHA256.match(digest[7:]):
                value = {
                    "url": str(asset.get("browser_download_url") or ""),
                    "sha256": digest[7:],
                    "version": str(release.get("tag_name") or "").removeprefix("gameaccess-v"),
                }
                break
    except (httpx.HTTPError, ValueError):
        value = {}
    with _lock:
        _release.update(at=now, value=value)
    return value


def _quoted(value: str) -> str:
    """A PowerShell single-quoted string: the only special character inside is the quote, doubled."""
    return "'" + value.replace("'", "''") + "'"


def render_script(code: str, release: dict) -> str:
    values = {
        "__API__": public_api_url(),
        "__CODE__": code,
        "__URL__": release.get("url", ""),
        "__SHA256__": release.get("sha256", ""),
        "__VERSION__": release.get("version", ""),
    }
    script = SCRIPT.read_text(encoding="utf-8")
    for name, value in values.items():
        script = script.replace(f"'{name}'", _quoted(value))
    return script


@router.post("/install/sessions")
def create_session(request: Request) -> dict:
    now = time.time()
    address = _address(request)
    with _lock:
        _prune(now)
        recent = [t for t in _created.get(address, []) if now - t < 3600]
        if len(recent) >= SESSIONS_PER_HOUR or len(_sessions) >= MAX_SESSIONS:
            _created[address] = recent
            raise HTTPException(429, "too_many_sessions")
        _created[address] = [*recent, now]
        code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        while code in _sessions:
            code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        _sessions[code] = {"created": now, "steps": {}, "events": 0, "fetched": False}
    return {"code": code, "command": command_for(code), "expires_in": SESSION_SECONDS}


@router.get("/i/{code}", response_class=PlainTextResponse)
def install_script(code: str) -> PlainTextResponse:
    code = code.upper()
    headers = {"Cache-Control": "no-store"}
    with _lock:
        _prune(time.time())
        row = _sessions.get(code) if _CODE.match(code) else None
        if row is not None:
            row["fetched"] = True
    if row is None:
        # Still a valid script: it tells the player to go back to the page instead of failing in red.
        message = "Este codigo de instalacion vencio. Volve a gameaccess.site y toca Instalar otra vez."
        return PlainTextResponse(f"Write-Host {_quoted(message)} -ForegroundColor Yellow\n", headers=headers,
                                 media_type="text/plain; charset=utf-8")
    return PlainTextResponse(render_script(code, latest_release()), headers=headers, media_type="text/plain; charset=utf-8")


@router.post("/install/sessions/{code}/events")
def add_event(code: str, event: InstallEvent) -> dict:
    code = code.upper()
    with _lock:
        row = _sessions.get(code)
        if row is None:
            raise HTTPException(404, "session_not_found")
        if row["events"] >= MAX_EVENTS:
            raise HTTPException(429, "too_many_events")
        row["events"] += 1
        row["steps"][event.step] = {"state": event.state, "detail": event.detail, "progress": event.progress}
    return {"ok": True}


@router.get("/install/sessions/{code}")
def session_state(code: str) -> dict:
    code = code.upper()
    with _lock:
        _prune(time.time())
        row = _sessions.get(code)
        if row is None:
            raise HTTPException(404, "session_not_found")
        steps = {name: dict(value) for name, value in row["steps"].items()}
        fetched = row["fetched"]
    failed = any(step["state"] == "error" for step in steps.values())
    done = steps.get("open", {}).get("state") == "ok"
    return {"code": code, "fetched": fetched, "steps": steps, "failed": failed, "done": done, "order": list(STEPS)}


@router.get("/setup/{name}")
def local_installer(name: str) -> FileResponse:
    folder = os.environ.get("GAMEACCESS_WEB_INSTALL_FILES", "").strip()
    path = Path(folder) / name if folder and _FILE.match(name) else None
    if path is None or not path.is_file():
        raise HTTPException(404, "not_found")
    return FileResponse(path, media_type="application/octet-stream")
