"""A player's own account (vault/Tareas.md L3): register and sign in from the app; optional, BASE needs none.

The account is US.1's `account` row (accounts.py), now also made by the player with a name, an email and a password.
Signing in gives a session token that the app keeps on that PC until the player signs out; only its SHA-256 is stored.
When a player registers or signs in, the PLUS key already activated on that installation is tied to the account: if
the account had no running PLUS, it takes the key's end date, so tying a key never shortens it (accounts.sync_keys
then makes the key follow the account, as with the keys Seba ties in /admin).
"""
from __future__ import annotations

import secrets
import threading
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, select

from .access_keys import AccessKey, canonical_installation_id, digest, utc
from .accounts import Account, check_password, create_account, link_key, normalize_email, now_utc, plus_active
from .api_dependencies import get_session

router = APIRouter()

# Guessing passwords: ten tries in fifteen minutes per email and per address; registering: five an hour per address.
LOGIN_TRIES, LOGIN_WINDOW = 10, 900
REGISTER_TRIES, REGISTER_WINDOW = 5, 3600
_attempts: dict[str, list[float]] = {}
_lock = threading.Lock()


class AccountSession(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    account_id: int = SQLField(index=True)
    token_hash: str = SQLField(index=True, unique=True)
    installation_id: str = ""
    created_at: datetime
    last_seen_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)
    language: str = Field(default="es", max_length=5)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


def _allow(keys: list[str], tries: int, window: int, now: float) -> bool:
    with _lock:
        recent = {key: [t for t in _attempts.get(key, []) if now - t < window] for key in keys}
        _attempts.update(recent)
        if any(len(times) >= tries for times in recent.values()):
            return False
        for key, times in recent.items():
            _attempts[key] = [*times, now]
        return True


def _installation(request: Request) -> str:
    try:
        return canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
    except ValueError as exc:
        raise HTTPException(400, "installation_required") from exc


def _address(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def attach_installation_keys(session: Session, account: Account, installation_id: str) -> int:
    """Ties this installation's running PLUS keys to the account, never shortening them. Returns how many."""
    now = now_utc()
    keys = session.exec(select(AccessKey).where(AccessKey.installation_id == installation_id, AccessKey.access_tier == "plus",
                                                AccessKey.revoked_at.is_(None), AccessKey.account_id.is_(None))).all()
    running = [key for key in keys if key.expires_at is None or utc(key.expires_at) > now]
    if not running:
        return 0
    ends = [utc(key.expires_at) for key in running if key.expires_at is not None]
    latest = max(ends) if ends else None
    if latest is not None and (not plus_active(account, now) or utc(account.plus_until) < latest):
        if not account.paid:
            account.paid_at = now
        account.paid, account.plus_until = True, latest
        account.paid_note = account.paid_note or "PLUS de la llave activada en la app"
        session.add(account)
        session.commit()
    for key in running:
        link_key(session, account, key.id)
    return len(running)


def _open_session(session: Session, account: Account, installation_id: str) -> str:
    token = secrets.token_urlsafe(32)
    session.add(AccountSession(account_id=account.id, token_hash=digest(token), installation_id=installation_id, created_at=now_utc()))
    session.commit()
    return token


def _me(account: Account) -> dict:
    return {"name": account.name, "email": account.email, "language": account.language,
            "plus_active": plus_active(account), "plus_until": utc(account.plus_until).isoformat() if account.plus_until else None}


def current_account(request: Request, session: Session = Depends(get_session)) -> tuple[Account, AccountSession]:
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    row = session.exec(select(AccountSession).where(AccountSession.token_hash == digest(token))).first() if token else None
    account = session.get(Account, row.account_id) if row is not None and row.revoked_at is None else None
    if account is None:
        raise HTTPException(401, "signed_out")
    row.last_seen_at = now_utc()
    session.add(row)
    session.commit()
    return account, row


@router.post("/accounts/register")
def register(req: RegisterRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    installation_id = _installation(request)
    if not _allow([f"register:{_address(request)}"], REGISTER_TRIES, REGISTER_WINDOW, time.time()):
        raise HTTPException(429, "too_many")
    try:
        account = create_account(session, email=req.email, name=req.name, password=req.password,
                                 language=req.language if req.language in ("es", "en") else "es")
    except ValueError as exc:
        raise HTTPException(409 if str(exc) == "email_taken" else 422, str(exc)) from exc
    attach_installation_keys(session, account, installation_id)
    token = _open_session(session, account, installation_id)
    session.refresh(account)
    return {"token": token, "account": _me(account)}


@router.post("/accounts/login")
def login(req: LoginRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    installation_id = _installation(request)
    try:
        email = normalize_email(req.email)
    except ValueError as exc:
        raise HTTPException(422, "invalid_email") from exc
    if not _allow([f"login:{email}", f"login:{_address(request)}"], LOGIN_TRIES, LOGIN_WINDOW, time.time()):
        raise HTTPException(429, "too_many")
    account = session.exec(select(Account).where(Account.email == email)).first()
    if account is None or not check_password(account, req.password):
        raise HTTPException(401, "bad_credentials")
    attach_installation_keys(session, account, installation_id)
    token = _open_session(session, account, installation_id)
    session.refresh(account)
    return {"token": token, "account": _me(account)}


@router.get("/accounts/me")
def me(signed=Depends(current_account)) -> dict:
    return _me(signed[0])


@router.post("/accounts/link-installation")
def link_installation(request: Request, signed=Depends(current_account), session: Session = Depends(get_session)) -> dict:
    """After a key is activated while signed in: tie it to the account."""
    account = session.get(Account, signed[0].id)
    linked = attach_installation_keys(session, account, _installation(request))
    session.refresh(account)
    return {"linked": linked, "account": _me(account)}


@router.post("/accounts/logout")
def logout(signed=Depends(current_account), session: Session = Depends(get_session)) -> dict:
    row = session.get(AccountSession, signed[1].id)
    row.revoked_at = now_utc()
    session.add(row)
    session.commit()
    return {"ok": True}
