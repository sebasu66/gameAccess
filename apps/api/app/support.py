"""Contact messages from the app (vault/Tareas.md L2): a player writes from Home › Help and contact, Seba reads it.

Any installation can write, BASE included: no activation is asked, only the installation id. Each message is kept
(the "Mensajes" section of /admin) and mailed to the support address through Resend's HTTP API, with the player's
email as Reply-To so Seba answers from his mailbox. Without GAMEACCESS_RESEND_API_KEY nothing is mailed and the message
waits in /admin. A phone alert (notify.py) says only that a message arrived: ntfy topics are public, so never its text.

Settings: GAMEACCESS_RESEND_API_KEY; GAMEACCESS_SUPPORT_TO (default game-access-contacto@proton.me);
GAMEACCESS_SUPPORT_FROM, a sender on a domain verified in Resend (default "Game Access <contacto@gameaccess.site>").
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from datetime import datetime
from typing import Callable, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, select

from .access_keys import canonical_installation_id, utc
from .access_service import _admin_activation_access, now_utc
from .api_dependencies import get_session
from .database import engine
from .notify import notify

logger = logging.getLogger("gameaccess.support")
router = APIRouter()

RESEND_URL = "https://api.resend.com/emails"
DEFAULT_TO = "game-access-contacto@proton.me"
DEFAULT_FROM = "Game Access <contacto@gameaccess.site>"
# A player with a real problem writes a few times; more than this in an hour, from one installation or one address, is
# a loop or abuse.
MESSAGES_PER_HOUR = 5
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_requests: dict[str, list[float]] = {}
_lock = threading.Lock()


class SupportMessage(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    created_at: datetime = SQLField(index=True)
    installation_id: str = SQLField(index=True)
    name: str = ""
    email: str = ""
    subject: str
    message: str
    language: str = "es"
    client_build: str = ""
    # What the player chose to attach: the app's recent activity log, already without the Windows user name.
    log: str = ""
    mailed_at: Optional[datetime] = None
    read_at: Optional[datetime] = None


class SupportMessageRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=5000)
    name: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=254)
    language: str = Field(default="es", max_length=5)
    client_build: str = Field(default="", max_length=120)
    log: str = Field(default="", max_length=20000)


def _allow(keys: list[str], now: float) -> bool:
    with _lock:
        recent = {key: [t for t in _requests.get(key, []) if now - t < 3600] for key in keys}
        if any(len(times) >= MESSAGES_PER_HOUR for times in recent.values()):
            _requests.update(recent)
            return False
        for key, times in recent.items():
            _requests[key] = [*times, now]
        return True


def _clean_log(log: str) -> str:
    return re.sub(r"(?i)C:\\Users\\[^\\\s]+", r"C:\\Users\\[user]", log)


def mail_body(row: SupportMessage) -> str:
    who = " · ".join(part for part in (row.name, row.email or "sin correo para responder") if part)
    lines = [row.message, "", "—", f"De: {who}", f"Idioma: {row.language} · Versión: {row.client_build or '?'}",
             f"Instalación: {row.installation_id}", f"Mensaje #{row.id} · también en /admin"]
    if row.log:
        lines += ["", "Registro adjunto:", row.log]
    return "\n".join(lines)


def send_mail(row: SupportMessage, post: Callable[..., httpx.Response] = httpx.post) -> bool:
    """Mail one message to Seba; returns whether Resend took it."""
    key = os.getenv("GAMEACCESS_RESEND_API_KEY", "").strip()
    if not key:
        logger.info("support_message_not_mailed id=%s reason=no_resend_key", row.id)
        return False
    payload = {"from": os.getenv("GAMEACCESS_SUPPORT_FROM", "").strip() or DEFAULT_FROM,
               "to": [os.getenv("GAMEACCESS_SUPPORT_TO", "").strip() or DEFAULT_TO],
               "subject": f"[Game Access] {row.subject}", "text": mail_body(row)}
    if row.email:
        payload["reply_to"] = row.email
    try:
        response = post(RESEND_URL, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=15)
    except httpx.HTTPError as exc:
        logger.warning("support_message_not_mailed id=%s error=%s", row.id, type(exc).__name__)
        return False
    if response.status_code >= 300:
        logger.warning("support_message_not_mailed id=%s status=%s", row.id, response.status_code)
        return False
    return True


def _deliver(message_id: int) -> None:
    # One alert every ten minutes at most: a burst of messages is one look at /admin.
    notify("support", "Game Access: mensaje nuevo", "Llegó un mensaje de contacto. Leelo en /admin.", priority=3, cooldown=600)
    with Session(engine) as session:
        row = session.get(SupportMessage, message_id)
        if row is not None and send_mail(row):
            row.mailed_at = now_utc()
            session.add(row)
            session.commit()


@router.post("/support/messages")
def write_message(req: SupportMessageRequest, request: Request, background: BackgroundTasks,
                  session: Session = Depends(get_session)) -> dict:
    try:
        installation_id = canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
    except ValueError as exc:
        raise HTTPException(400, "Installation id required") from exc
    email = req.email.strip()
    if email and not _EMAIL.match(email):
        raise HTTPException(422, "invalid_email")
    if not req.subject.strip() or not req.message.strip():
        raise HTTPException(422, "empty_message")
    address = request.client.host if request.client else "unknown"
    if not _allow([f"installation:{installation_id}", f"address:{address}"], time.time()):
        raise HTTPException(429, "Too many messages")
    row = SupportMessage(created_at=now_utc(), installation_id=installation_id, name=req.name.strip(), email=email,
                         subject=req.subject.strip(), message=req.message.strip(),
                         language=req.language if req.language in ("es", "en") else "es",
                         client_build=req.client_build.strip(), log=_clean_log(req.log))
    session.add(row)
    session.commit()
    session.refresh(row)
    background.add_task(_deliver, row.id)
    return {"ok": True, "id": row.id}


def _public(row: SupportMessage) -> dict:
    return {"id": row.id, "created_at": utc(row.created_at).isoformat(), "installation_id": row.installation_id,
            "name": row.name, "email": row.email, "subject": row.subject, "message": row.message,
            "language": row.language, "client_build": row.client_build, "log": row.log,
            "mailed_at": utc(row.mailed_at).isoformat() if row.mailed_at else None,
            "read_at": utc(row.read_at).isoformat() if row.read_at else None}


@router.get("/admin/support-messages")
def list_messages(request: Request, limit: int = Query(default=200, ge=1, le=1000),
                  session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    rows = session.exec(select(SupportMessage).order_by(SupportMessage.id.desc()).limit(limit)).all()
    return {"messages": [_public(row) for row in rows]}


@router.post("/admin/support-messages/{message_id}/read")
def mark_read(message_id: int, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    row = session.get(SupportMessage, message_id)
    if row is None:
        raise HTTPException(404, "message_not_found")
    row.read_at = row.read_at or now_utc()
    session.add(row)
    session.commit()
    return _public(row)
