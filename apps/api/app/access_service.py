"""Access service."""
from __future__ import annotations
import logging
import os
import secrets
from datetime import datetime, timezone
from fastapi import HTTPException, Request
from sqlmodel import Session
from .models import AccessEvent
from .admin_auth import admin_authenticated
from .access_keys import AccessKey, valid_session
from .access_overrides import CourtesySession, valid_courtesy_session
_access_logger = logging.getLogger("gameaccess.access")

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _admin_activation_access(request: Request) -> None:
    if admin_authenticated(request):
        return
    configured = os.environ.get("GAMEACCESS_ADMIN_TOKEN", "")
    if len(configured) < 32:
        raise HTTPException(503, "Activation key issuance is not configured")
    supplied = request.headers.get("X-GameAccess-Admin-Token", "")
    if not secrets.compare_digest(supplied, configured):
        raise HTTPException(403, "Administrator access required")


def _activation_for_request(request: Request, session: Session) -> AccessKey | CourtesySession | None:
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    installation_id = request.headers.get("X-GameAccess-Installation", "")
    return valid_session(session, token, installation_id) or valid_courtesy_session(
        session, token, installation_id
    )


def _record_access_event(
    session: Session,
    *,
    installation_id: str,
    action: str,
    outcome: str,
    reason: str,
    game_id: int | None = None,
    app_id: int | None = None,
    lease_id: int | None = None,
    account_id: int | None = None,
    commit: bool = False,
) -> None:
    installation_id = str(installation_id or "")[:64]
    _access_logger.info(
        "action=%s outcome=%s reason=%s installation=%s game_id=%s app_id=%s lease_id=%s account_id=%s",
        action,
        outcome,
        reason,
        installation_id or "-",
        game_id,
        app_id,
        lease_id,
        account_id,
    )
    session.add(
        AccessEvent(
            created_at=now_utc(),
            installation_id=installation_id,
            action=action[:80],
            outcome=outcome[:40],
            reason=reason[:240],
            game_id=game_id,
            app_id=app_id,
            lease_id=lease_id,
            account_id=account_id,
        )
    )
    if commit:
        session.commit()


def _reject_access(
    session: Session,
    *,
    installation_id: str,
    action: str,
    reason: str,
    status_code: int,
    user_message: str,
    game_id: int | None = None,
    app_id: int | None = None,
    lease_id: int | None = None,
    account_id: int | None = None,
) -> None:
    _record_access_event(
        session,
        installation_id=installation_id,
        action=action,
        outcome="denied",
        reason=reason,
        game_id=game_id,
        app_id=app_id,
        lease_id=lease_id,
        account_id=account_id,
        commit=True,
    )
    raise HTTPException(status_code, user_message)
