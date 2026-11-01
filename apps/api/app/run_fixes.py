"""What made a game run on a PC where it did not: shared, and asked for only when the same problem shows up.

When the launch dialog's automatic fix works, the app reports what it changed (`POST /run-fixes/report`): a short list of
known switches, never commands or paths. Each report is one vote of one installation (a keyed hash of its id, no
personal data). When another PC cannot start that game, it asks (`GET /run-fixes/{app_id}`) and gets the fix most
installations agree on, once `GAMEACCESS_RUNFIX_MIN_REPORTS` (default 2) of them reported the same one.

A fix is only this, validated here and again by the launcher before it is applied:
  steam (bool)       start Steam in the background first
  launchers (list)   store launchers to start (epic, ubisoft, ea, rockstar, paradox, battlenet)
  language ("keep")  leave the game's language settings as its fix has them
  runtimes (list)    redistributables to install, from KNOWN_RUNTIMES
  fixBackup (bool)   re-apply the fix archive saved when it was installed
  runAsAdmin (bool)  run the game as administrator
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from collections import Counter
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import UniqueConstraint
from sqlmodel import Field as SQLField, Session, SQLModel, select

from .access_keys import canonical_installation_id
from .access_service import now_utc
from .api_dependencies import get_session

router = APIRouter(tags=["run-fixes"])

KNOWN_LAUNCHERS = ("epic", "ubisoft", "ea", "rockstar", "paradox", "battlenet")
KNOWN_RUNTIMES = tuple(f"{kind} {arch}" for kind in ("vc2010", "vc2012", "vc2013", "vc2015", "directx") for arch in ("x86", "x64"))
REPORTS_PER_HOUR = 20
_requests: dict[str, list[float]] = {}
_lock = threading.Lock()


class RunFixReport(SQLModel, table=True):
    """One installation's word that this fix made this game run."""

    __tablename__ = "run_fix_report"
    __table_args__ = (UniqueConstraint("app_id", "voter", "fix_key", name="uq_run_fix_vote"),)

    id: Optional[int] = SQLField(default=None, primary_key=True)
    app_id: int = SQLField(index=True)
    fix_key: str = SQLField(max_length=400)
    voter: str = SQLField(max_length=64)
    created_at: datetime = SQLField(index=True)


class RunFix(BaseModel):
    steam: bool = False
    launchers: list[str] = Field(default_factory=list, max_length=6)
    language: Optional[str] = None
    runtimes: list[str] = Field(default_factory=list, max_length=10)
    fixBackup: bool = False
    runAsAdmin: bool = False


class RunFixReportRequest(BaseModel):
    app_id: int = Field(ge=1)
    fix: RunFix


def clean_fix(fix: RunFix) -> dict:
    """The fix reduced to its known switches, in one canonical form (so equal fixes get equal keys)."""
    if fix.language not in (None, "keep"):
        raise HTTPException(422, "Unknown language setting")
    unknown = [item for item in fix.runtimes if item not in KNOWN_RUNTIMES]
    if unknown:
        raise HTTPException(422, "Unknown runtime")
    if any(item not in KNOWN_LAUNCHERS for item in fix.launchers):
        raise HTTPException(422, "Unknown launcher")
    cleaned = {"steam": fix.steam, "launchers": sorted(set(fix.launchers)), "language": fix.language, "runtimes": sorted(set(fix.runtimes)), "fixBackup": fix.fixBackup, "runAsAdmin": fix.runAsAdmin}
    if not (cleaned["steam"] or cleaned["launchers"] or cleaned["language"] or cleaned["runtimes"] or cleaned["fixBackup"] or cleaned["runAsAdmin"]):
        raise HTTPException(422, "An empty fix is not worth keeping")
    return cleaned


def min_reports() -> int:
    try:
        return max(1, int(os.environ.get("GAMEACCESS_RUNFIX_MIN_REPORTS", "2")))
    except ValueError:
        return 2


def _voter(installation_id: str) -> str:
    secret = os.environ.get("GAMEACCESS_KEY_SECRET") or os.environ.get("GAMEACCESS_ADMIN_TOKEN") or "gameaccess-lessons"
    return hmac.new(secret.encode(), ("runfix:" + installation_id).encode(), hashlib.sha256).hexdigest()[:32]


def _allow(address: str, now: float) -> bool:
    with _lock:
        recent = [stamp for stamp in _requests.get(address, []) if now - stamp < 3600]
        if len(recent) >= REPORTS_PER_HOUR:
            _requests[address] = recent
            return False
        recent.append(now)
        _requests[address] = recent
        return True


def _installation(request: Request) -> str:
    try:
        return canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
    except ValueError as exc:
        raise HTTPException(400, "Installation id required") from exc


@router.post("/run-fixes/report")
def report_fix(req: RunFixReportRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    cleaned = clean_fix(req.fix)
    voter = _voter(_installation(request))
    if not _allow(request.client.host if request.client else "unknown", time.time()):
        raise HTTPException(429, "Too many reports")
    key = json.dumps(cleaned, sort_keys=True, separators=(",", ":"))
    exists = session.exec(select(RunFixReport.id).where(RunFixReport.app_id == req.app_id, RunFixReport.voter == voter,
                                                         RunFixReport.fix_key == key)).first()
    if exists is not None:
        return {"ok": True, "counted": False}
    session.add(RunFixReport(app_id=req.app_id, fix_key=key, voter=voter, created_at=now_utc()))
    session.commit()
    return {"ok": True, "counted": True}


def best_fix(session: Session, app_id: int) -> tuple[Optional[dict], int]:
    """The fix most installations agree on for the game (at least `min_reports()` of them), and its votes."""
    rows = session.exec(select(RunFixReport.fix_key).where(RunFixReport.app_id == app_id)).all()
    if not rows:
        return None, 0
    key, votes = Counter(rows).most_common(1)[0]
    return (json.loads(key), votes) if votes >= min_reports() else (None, votes)


@router.get("/run-fixes/{app_id}")
def get_fix(app_id: int, response: Response, request: Request, session: Session = Depends(get_session)) -> dict:
    """The game does not run here: is there a fix? Asked only then, never in advance."""
    if app_id < 1:
        raise HTTPException(422, "Invalid AppID")
    _installation(request)
    response.headers["Cache-Control"] = "no-cache"
    fix, votes = best_fix(session, app_id)
    return {"app_id": app_id, "fix": fix, "reports": votes}
