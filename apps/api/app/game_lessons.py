"""What players learned about each game, shared so it does not happen to the next one (vault/Lo aprendido por juego.md).

Every lesson belongs to a game (AppID) and has a kind; the kinds are open, today:
- `bad_source`: a download source that does not work for the game (it held no game, the password was wrong...). The
  source is named by its fingerprint, the same SHA-256 the ViKiNG cache uses
  (`viking_cache_service.normalize_source_url`): the server never receives or keeps its URL. A whole provider can
  also be marked (`scope: "provider"`).
- `how_to_run`: special requirements or steps to run the game (text, and later an execution profile).
- `abandoned`: the game is no longer valid (its developers dropped it) and is discarded from the offer.

Players report bad sources on their own; each report is one vote of one installation, kept as a keyed hash of its id
(no personal data, and the same player reporting twice counts once). A lesson is published once
`GAMEACCESS_LESSON_MIN_REPORTS` different installations (default 2) agree, or right away when an administrator writes
it; the other kinds are written by an administrator only.

Published lessons live in `game_lesson`, each with a revision (microseconds). Clients keep a copy in their local
catalog database and ask only for what changed since their revision (`GET /game-lessons?since=`), together with the
catalog synchronization; reading them never waits for the network.
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
from sqlalchemy import BigInteger, Column, UniqueConstraint, func
from sqlmodel import Field as SQLField, Session, SQLModel, select

from .access_keys import canonical_installation_id
from .access_service import _admin_activation_access, now_utc
from .api_dependencies import get_session

router = APIRouter(tags=["game-lessons"])

Scope = Literal["source", "provider", "game"]
Action = Literal["avoid", "prefer", "note", "discard"]
# What a player may report on their own: bad sources, for these reasons. Administrators may write any short code.
REPORTABLE_REASONS = ("not_a_game", "wrong_password", "corrupt_archive", "malware_flagged", "incomplete")
ADMIN_VOTER = "admin"
# Per client address: reports per hour. A player reports a handful at most.
REPORTS_PER_HOUR = 30
FINGERPRINT = re.compile(r"^[0-9a-f]{64}$")
CODE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")

_requests: dict[str, list[float]] = {}
_lock = threading.Lock()
_last_revision = 0


class GameLessonReport(SQLModel, table=True):
    """One vote (an installation's report, or the administrator's word) for one lesson."""

    __tablename__ = "game_lesson_report"
    __table_args__ = (UniqueConstraint("kind", "scope", "subject", "reason", "voter", name="uq_game_lesson_vote"),)

    id: Optional[int] = SQLField(default=None, primary_key=True)
    kind: str = SQLField(index=True, max_length=40)
    scope: str = SQLField(max_length=16)
    subject: str = SQLField(index=True, max_length=120)
    reason: str = SQLField(max_length=40)
    app_id: Optional[int] = SQLField(default=None, index=True)
    action: str = SQLField(default="avoid", max_length=16)
    # What the client saw, as short codes only ("audio,images" for a download that held no game).
    detail: str = SQLField(default="", max_length=200)
    # The administrator's instructions (how_to_run); players never send text.
    text: str = SQLField(default="", max_length=2000)
    # Keyed hash of the installation id (or "admin"): counts distinct reporters without keeping who they are.
    voter: str = SQLField(max_length=64)
    created_at: datetime = SQLField(index=True)


class GameLesson(SQLModel, table=True):
    """A lesson as clients see it, kept up to date on every vote; `published` false = taken back from clients."""

    __tablename__ = "game_lesson"
    __table_args__ = (UniqueConstraint("kind", "scope", "subject", "reason", name="uq_game_lesson"),)

    id: Optional[int] = SQLField(default=None, primary_key=True)
    kind: str = SQLField(max_length=40)
    scope: str = SQLField(max_length=16)
    subject: str = SQLField(max_length=120)
    reason: str = SQLField(max_length=40)
    app_id: Optional[int] = SQLField(default=None, index=True)
    action: str = SQLField(default="avoid", max_length=16)
    text: str = SQLField(default="", max_length=2000)
    detail: str = SQLField(default="", max_length=200)
    reports: int = 0
    confidence: str = SQLField(default="flagged", max_length=16)
    published: bool = False
    first_seen: datetime
    last_seen: datetime
    revision: int = SQLField(default=0, sa_column=Column(BigInteger, index=True, nullable=False))


class LessonReportRequest(BaseModel):
    kind: str = Field(default="bad_source", min_length=2, max_length=40)
    scope: Scope = "source"
    subject: str = Field(min_length=1, max_length=120)
    reason: str = Field(min_length=2, max_length=40)
    app_id: Optional[int] = Field(default=None, ge=1)
    detail: list[str] = Field(default_factory=list, max_length=8)


class AdminLessonRequest(LessonReportRequest):
    action: Action = "avoid"
    text: str = Field(default="", max_length=2000)
    # True takes the administrator's lesson back (players' reports, if any, still count).
    retract: bool = False


def min_reports() -> int:
    try:
        return max(1, int(os.environ.get("GAMEACCESS_LESSON_MIN_REPORTS", "2")))
    except ValueError:
        return 2


def _voter(installation_id: str) -> str:
    secret = os.environ.get("GAMEACCESS_KEY_SECRET") or os.environ.get("GAMEACCESS_ADMIN_TOKEN") or "gameaccess-lessons"
    return hmac.new(secret.encode(), ("lesson:" + installation_id).encode(), hashlib.sha256).hexdigest()[:32]


def _next_revision() -> int:
    """Microseconds, never repeated within this server."""
    global _last_revision
    with _lock:
        _last_revision = max(_last_revision + 1, time.time_ns() // 1000)
        return _last_revision


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


def _refresh_lesson(session: Session, kind: str, scope: str, subject: str, reason: str) -> None:
    """Recount the votes of one lesson and store what clients see, with a new revision when it changed."""
    votes = session.exec(select(GameLessonReport).where(
        GameLessonReport.kind == kind, GameLessonReport.scope == scope, GameLessonReport.subject == subject,
        GameLessonReport.reason == reason).order_by(GameLessonReport.created_at)).all()
    lesson = session.exec(select(GameLesson).where(GameLesson.kind == kind, GameLesson.scope == scope,
                                                   GameLesson.subject == subject, GameLesson.reason == reason)).first()
    if not votes and lesson is None:
        return
    admin = next((vote for vote in votes if vote.voter == ADMIN_VOTER), None)
    players = [vote for vote in votes if vote.voter != ADMIN_VOTER]
    threshold = min_reports()
    if lesson is None:
        lesson = GameLesson(kind=kind, scope=scope, subject=subject, reason=reason,
                            first_seen=votes[0].created_at, last_seen=votes[0].created_at)
    lesson.reports = len(players)
    lesson.published = admin is not None or len(players) >= threshold
    lesson.confidence = "confirmed" if admin is not None or len(players) >= threshold * 2 else "flagged"
    if votes:
        lesson.first_seen, lesson.last_seen = votes[0].created_at, votes[-1].created_at
        lesson.app_id = (admin.app_id if admin and admin.app_id else None) or next((v.app_id for v in votes if v.app_id), None)
        lesson.detail = next((v.detail for v in reversed(votes) if v.detail), "")
    lesson.action = admin.action if admin else "avoid"
    lesson.text = admin.text if admin else ""
    lesson.revision = _next_revision()
    session.add(lesson)
    session.commit()


def _validate(req: LessonReportRequest) -> str:
    if not CODE.match(req.kind) or not CODE.match(req.reason):
        raise HTTPException(422, "Kind and reason are short codes (letters, digits, underscore)")
    if req.kind == "bad_source" and req.scope == "game":
        raise HTTPException(422, "A bad source is a source fingerprint or a provider")
    if req.kind != "bad_source" and req.scope != "game":
        raise HTTPException(422, "This kind of lesson is about a game: scope 'game' with its AppID")
    subject = _subject(req.scope, req.subject)
    if req.scope == "game":
        req.app_id = int(subject)
    return subject


def _add_vote(session: Session, req: LessonReportRequest, subject: str, voter: str, *, action: str = "avoid", text: str = "") -> bool:
    """Store one vote; False when this voter had already said the same."""
    exists = session.exec(select(GameLessonReport.id).where(
        GameLessonReport.kind == req.kind, GameLessonReport.scope == req.scope, GameLessonReport.subject == subject,
        GameLessonReport.reason == req.reason, GameLessonReport.voter == voter)).first()
    if exists is not None:
        return False
    session.add(GameLessonReport(kind=req.kind, scope=req.scope, subject=subject, reason=req.reason, app_id=req.app_id,
                                 action=action, text=text.strip()[:2000], detail=_detail(req.detail), voter=voter,
                                 created_at=now_utc()))
    session.commit()
    _refresh_lesson(session, req.kind, req.scope, subject, req.reason)
    return True


def _public(lesson: GameLesson) -> dict:
    return {
        "kind": lesson.kind, "scope": lesson.scope, "subject": lesson.subject, "reason": lesson.reason,
        "app_id": lesson.app_id, "action": lesson.action, "text": lesson.text,
        "detail": [d for d in lesson.detail.split(",") if d], "reports": lesson.reports, "confidence": lesson.confidence,
        "first_seen": lesson.first_seen.isoformat(), "last_seen": lesson.last_seen.isoformat(),
    }


def lessons_since(session: Session, since: int = 0) -> dict:
    """since=0: every published lesson (`full`). Otherwise what changed after that revision: published lessons to
    keep and the keys of the ones taken back (`removed`)."""
    revision = session.exec(select(func.max(GameLesson.revision))).one() or 0
    if since <= 0 or since > revision:
        rows = session.exec(select(GameLesson).where(GameLesson.published == True)).all()  # noqa: E712
        return {"revision": revision, "full": True, "lessons": [_public(row) for row in rows], "removed": []}
    rows = session.exec(select(GameLesson).where(GameLesson.revision > since)).all()
    return {"revision": revision, "full": False,
            "lessons": [_public(row) for row in rows if row.published],
            "removed": [{"kind": r.kind, "scope": r.scope, "subject": r.subject, "reason": r.reason} for r in rows if not r.published]}


@router.post("/game-lessons/report")
def report_lesson(req: LessonReportRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    if req.kind != "bad_source" or req.reason not in REPORTABLE_REASONS:
        raise HTTPException(422, "Players report bad download sources only, for a known reason")
    subject = _validate(req)
    try:
        installation_id = canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
    except ValueError as exc:
        raise HTTPException(400, "Installation id required") from exc
    address = request.client.host if request.client else "unknown"
    if not _allow(address, time.time()):
        raise HTTPException(429, "Too many reports")
    return {"ok": True, "counted": _add_vote(session, req, subject, _voter(installation_id))}


@router.get("/game-lessons")
def list_lessons(response: Response, since: int = Query(default=0, ge=0), session: Session = Depends(get_session)) -> dict:
    response.headers["Cache-Control"] = "no-cache"
    return {**lessons_since(session, since), "min_reports": min_reports()}


@router.post("/admin/game-lessons")
def admin_lesson(req: AdminLessonRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    """Something learned by hand (how to run a game, a game that is no longer valid) is published at once."""
    _admin_activation_access(request)
    subject = _validate(req)
    if req.retract:
        vote = session.exec(select(GameLessonReport).where(
            GameLessonReport.kind == req.kind, GameLessonReport.scope == req.scope, GameLessonReport.subject == subject,
            GameLessonReport.reason == req.reason, GameLessonReport.voter == ADMIN_VOTER)).first()
        if vote is not None:
            session.delete(vote)
            session.commit()
        _refresh_lesson(session, req.kind, req.scope, subject, req.reason)
        return {"ok": True}
    # The administrator's word replaces an earlier one for the same lesson.
    old = session.exec(select(GameLessonReport).where(
        GameLessonReport.kind == req.kind, GameLessonReport.scope == req.scope, GameLessonReport.subject == subject,
        GameLessonReport.reason == req.reason, GameLessonReport.voter == ADMIN_VOTER)).first()
    if old is not None:
        session.delete(old)
        session.commit()
    _add_vote(session, req, subject, ADMIN_VOTER, action=req.action, text=req.text)
    return {"ok": True}

