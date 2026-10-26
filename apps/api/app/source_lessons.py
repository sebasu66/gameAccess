"""What players learned about download sources, shared so it does not happen to the next one.

A client that finds a bad source (the download held no game, the archive password was wrong, the archive was
broken...) reports it here with the source's fingerprint and the reason. The fingerprint is the same SHA-256 the
ViKiNG cache uses (`viking_cache_service.normalize_source_url`): the server never receives or keeps the URL.

Each report is one vote of one installation, kept as a keyed hash of its id (no personal data, and the same player
reporting twice counts once). A lesson is published once `GAMEACCESS_LESSON_MIN_REPORTS` different installations
(default 2) agree, or right away when an administrator writes it. Clients read the published list (`GET
/source-lessons`) and move those sources to the end with the reason, so the default download never picks one.

A lesson has a scope (`source`: one fingerprint, `provider`: a source name, `game`: an AppID), a reason, an action
(`avoid` today; `prefer` and `note` are for advice that is not a blacklist) and its dates.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import threading
import time
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import UniqueConstraint
from sqlmodel import Field as SQLField, Session, SQLModel, select

from .access_keys import canonical_installation_id
from .access_service import _admin_activation_access, now_utc
from .api_dependencies import get_session

router = APIRouter(tags=["source-lessons"])

Scope = Literal["source", "provider", "game"]
Action = Literal["avoid", "prefer", "note"]
# Reasons a client may report on its own. Administrators may write any short code.
REPORTABLE_REASONS = ("not_a_game", "wrong_password", "corrupt_archive", "malware_flagged", "incomplete")
ADMIN_VOTER = "admin"
# Per client address: reports per hour. A player reports a handful at most.
REPORTS_PER_HOUR = 30
FINGERPRINT = re.compile(r"^[0-9a-f]{64}$")
CODE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")

_requests: dict[str, list[float]] = {}
_lock = threading.Lock()


class SourceLessonReport(SQLModel, table=True):
    """One installation's vote that a source (or provider, or game) should be avoided, and why."""

    __tablename__ = "source_lesson_report"
    __table_args__ = (UniqueConstraint("scope", "subject", "reason", "voter", name="uq_source_lesson_vote"),)

    id: Optional[int] = SQLField(default=None, primary_key=True)
    scope: str = SQLField(index=True, max_length=16)
    subject: str = SQLField(index=True, max_length=120)
    reason: str = SQLField(index=True, max_length=40)
    action: str = SQLField(default="avoid", max_length=16)
    app_id: Optional[int] = SQLField(default=None, index=True)
    # What the client saw, as short codes only ("audio,images" for a download that held no game).
    detail: str = SQLField(default="", max_length=200)
    # Keyed hash of the installation id (or "admin"): counts distinct reporters without keeping who they are.
    voter: str = SQLField(max_length=64)
    created_at: datetime = SQLField(index=True)


class LessonReportRequest(BaseModel):
    scope: Scope = "source"
    subject: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=2, max_length=40)
    app_id: Optional[int] = Field(default=None, ge=1)
    detail: list[str] = Field(default_factory=list, max_length=8)


class AdminLessonRequest(LessonReportRequest):
    action: Action = "avoid"


def min_reports() -> int:
    try:
        return max(1, int(os.environ.get("GAMEACCESS_LESSON_MIN_REPORTS", "2")))
    except ValueError:
        return 2


def _voter(installation_id: str) -> str:
    secret = os.environ.get("GAMEACCESS_KEY_SECRET") or os.environ.get("GAMEACCESS_ADMIN_TOKEN") or "gameaccess-lessons"
    return hmac.new(secret.encode(), ("lesson:" + installation_id).encode(), hashlib.sha256).hexdigest()[:32]


def _subject(scope: str, value: str) -> str:
    value = value.strip()
    if scope == "source":
        value = value.lower()
        if not FINGERPRINT.match(value):
            raise HTTPException(422, "A source is reported by its SHA-256 fingerprint, never by its address")
        return value
    if scope == "game":
        if not value.isdigit():
            raise HTTPException(422, "A game is reported by its AppID")
        return str(int(value))
    # A provider is the source name the plugin shows ("FitGirl"); compared without case or spaces around it.
    if "://" in value or value.lower().startswith("magnet:"):
        raise HTTPException(422, "A provider is reported by its name, never by an address")
    return re.sub(r"\s+", " ", value).lower()[:120]


def _detail(values: list[str]) -> str:
    return ",".join(item for item in (re.sub(r"[^a-z0-9_]", "", str(v).lower())[:24] for v in values) if item)[:200]


def _allow(address: str, now: float) -> bool:
    with _lock:
        recent = [t for t in _requests.get(address, []) if now - t < 3600]
        if len(recent) >= REPORTS_PER_HOUR:
            _requests[address] = recent
            return False
        _requests[address] = [*recent, now]
        return True


def _add_vote(session: Session, req: LessonReportRequest, voter: str, action: str) -> bool:
    """Store one vote; False when this voter had already said the same."""
    subject = _subject(req.scope, req.subject)
    exists = session.exec(select(SourceLessonReport.id).where(
        SourceLessonReport.scope == req.scope, SourceLessonReport.subject == subject,
        SourceLessonReport.reason == req.reason, SourceLessonReport.voter == voter)).first()
    if exists is not None:
        return False
    session.add(SourceLessonReport(scope=req.scope, subject=subject, reason=req.reason, action=action,
                                   app_id=req.app_id, detail=_detail(req.detail), voter=voter, created_at=now_utc()))
    session.commit()
    return True


def published_lessons(session: Session, threshold: int | None = None) -> list[dict]:
    """The lessons with enough distinct reporters (or an administrator's word), newest first."""
    threshold = threshold or min_reports()
    groups: dict[tuple[str, str, str], dict] = {}
    for row in session.exec(select(SourceLessonReport).order_by(SourceLessonReport.created_at)).all():
        key = (row.scope, row.subject, row.reason)
        group = groups.setdefault(key, {"scope": row.scope, "subject": row.subject, "reason": row.reason,
                                        "action": row.action, "app_id": row.app_id, "voters": set(), "admin": False,
                                        "detail": "", "first_seen": row.created_at, "last_seen": row.created_at})
        group["voters"].add(row.voter)
        group["last_seen"] = row.created_at
        group["app_id"] = group["app_id"] or row.app_id
        group["detail"] = row.detail or group["detail"]
        if row.voter == ADMIN_VOTER:
            group["admin"] = True
            group["action"] = row.action
    lessons = []
    for group in groups.values():
        reports = len(group["voters"] - {ADMIN_VOTER})
        if not group["admin"] and reports < threshold:
            continue
        lessons.append({
            "scope": group["scope"], "subject": group["subject"], "reason": group["reason"], "action": group["action"],
            "app_id": group["app_id"], "detail": [d for d in group["detail"].split(",") if d], "reports": reports,
            "confidence": "confirmed" if group["admin"] or reports >= threshold * 2 else "flagged",
            "first_seen": group["first_seen"].isoformat(), "last_seen": group["last_seen"].isoformat(),
        })
    lessons.sort(key=lambda item: item["last_seen"], reverse=True)
    return lessons


@router.post("/source-lessons/report")
def report_lesson(req: LessonReportRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    if req.reason not in REPORTABLE_REASONS:
        raise HTTPException(422, "Unknown reason")
    try:
        installation_id = canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
    except ValueError as exc:
        raise HTTPException(400, "Installation id required") from exc
    address = request.client.host if request.client else "unknown"
    if not _allow(address, time.time()):
        raise HTTPException(429, "Too many reports")
    counted = _add_vote(session, req, _voter(installation_id), "avoid")
    return {"ok": True, "counted": counted}


@router.get("/source-lessons")
def list_lessons(response: Response, since: str = Query(default="", max_length=64),
                 session: Session = Depends(get_session)) -> dict:
    """The whole published list (it is small). `since` = the revision the client has: unchanged answers say so."""
    lessons = published_lessons(session)
    revision = hashlib.sha256(repr([(l["scope"], l["subject"], l["reason"], l["action"], l["reports"]) for l in lessons])
                              .encode()).hexdigest()[:16]
    response.headers["Cache-Control"] = "public, max-age=300"
    if since and since == revision:
        return {"revision": revision, "unchanged": True}
    return {"revision": revision, "min_reports": min_reports(), "lessons": lessons}


@router.post("/admin/source-lessons")
def admin_add_lesson(req: AdminLessonRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    """Something learned by hand ("this provider's archives need the password from its page") is published at once."""
    _admin_activation_access(request)
    if not CODE.match(req.reason):
        raise HTTPException(422, "The reason is a short code (letters, digits, underscore)")
    _add_vote(session, req, ADMIN_VOTER, req.action)
    return {"ok": True}
