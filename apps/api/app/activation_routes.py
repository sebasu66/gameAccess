"""Activation routes."""
from __future__ import annotations
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlmodel import Session, select
from .api_schemas import AccessKeyRedeemRequest
from .api_dependencies import get_session
from .local_database import local_engine
from .database import engine
from .access_keys import AccessKey, canonical_installation_id, note_client, redeem_key, session_end_details, utc, valid_session
from .access_overrides import CourtesySession, courtesy_access_tier, redeem_courtesy_key, valid_courtesy_session
from .access_service import now_utc, _activation_for_request, _record_access_event

router = APIRouter()


def client_address(request: Request) -> str:
    """The player's public address: Render puts it first in X-Forwarded-For."""
    forwarded = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "")


def client_description(request: Request) -> str:
    """What the app says it is (version and PC name), or the browser's User-Agent for older versions."""
    return request.headers.get("X-GameAccess-Client") or request.headers.get("User-Agent", "")


def _note(session: Session, row, request: Request | None) -> None:
    if request is not None and isinstance(row, AccessKey):
        try:
            note_client(session, row, client_address(request), client_description(request))
        except Exception:  # presence is informative; it never blocks access
            session.rollback()

async def require_active_installation(request: Request, call_next):
    path = request.url.path
    protected = ("/users/",)
    if request.method != "OPTIONS" and any(path == prefix or path.startswith(prefix) for prefix in protected):
        with Session(engine) as session:
            if _activation_for_request(request, session) is None:
                installation_id = request.headers.get("X-GameAccess-Installation", "")
                _record_access_event(
                    session,
                    installation_id=installation_id,
                    action=f"{request.method} {path}",
                    outcome="denied",
                    reason="activation_missing_or_expired",
                    commit=True,
                )
                return JSONResponse(
                    {"detail": "Tu tiempo de acceso terminó. Ingresa una nueva llave para continuar."},
                    status_code=401,
                )
    return await call_next(request)


@router.post("/activation/redeem")
def redeem_access_key(req: AccessKeyRedeemRequest, session: Session = Depends(get_session), response: Response = None,
                      request: Request = None) -> dict:
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    installation_id = str(req.installation_id or "")
    try:
        installation_id = canonical_installation_id(installation_id)
        courtesy = redeem_courtesy_key(session, req.key, installation_id)
        token, expires_at = courtesy if courtesy is not None else redeem_key(session, req.key, installation_id)
    except ValueError as exc:
        _record_access_event(
            session,
            installation_id=installation_id,
            action="activation-redeem",
            outcome="denied",
            reason=f"activation_key_rejected:{str(exc)[:160]}",
            commit=True,
        )
        raise HTTPException(400, str(exc)) from exc
    _record_access_event(
        session,
        installation_id=installation_id,
        action="activation-redeem",
        outcome="allowed",
        reason="activation_session_issued",
        commit=True,
    )
    row = valid_courtesy_session(session, token, installation_id) if courtesy is not None else valid_session(session, token, installation_id)
    _note(session, row, request)
    return {"session_token": token, "installation_id": installation_id, "expires_at": expires_at,
            "cacheable": courtesy is None,
            "access_tier": courtesy_access_tier(row) if courtesy is not None else row.access_tier}


@router.get("/activation/status")
def activation_status(request: Request, session: Session = Depends(get_session), response: Response = None) -> dict:
    if response is not None:
        response.headers["Cache-Control"] = "no-store"
    row = _activation_for_request(request, session)
    if row is None:
        _record_access_event(
            session,
            installation_id=request.headers.get("X-GameAccess-Installation", ""),
            action="activation-status",
            outcome="denied",
            reason="activation_missing_or_expired",
            commit=True,
        )
        token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        detail = session_end_details(session, token, request.headers.get("X-GameAccess-Installation", ""))
        if detail["reason"] == "unavailable" and token:
            # Courtesy sessions can be expired even when their private issuer
            # configuration no longer authorizes them. Only reveal a date to
            # the token's own installation.
            from .access_keys import digest
            try:
                installation = canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
            except ValueError:
                installation = ""
            previous = session.exec(select(CourtesySession).where(
                CourtesySession.session_hash == digest(token),
                CourtesySession.installation_id == installation,
            )).first() if installation and len(token) <= 200 else None
            if previous and utc(previous.expires_at) <= now_utc():
                detail = {"reason": "expired", "expires_at": utc(previous.expires_at).isoformat()}
        raise HTTPException(401, detail)
    _note(session, row, request)
    try:
        from .telemetry import record_heartbeat
        installation_id = canonical_installation_id(request.headers.get("X-GameAccess-Installation", ""))
        access_tier = courtesy_access_tier(row) if isinstance(row, CourtesySession) else row.access_tier
        with Session(local_engine) as local_session:  # client presence is local per-instance data, not shared Supabase
            record_heartbeat(local_session, installation_id, access_tier)
    except ValueError:
        pass
    return {"active": True, "expires_at": utc(row.expires_at), "server_time": now_utc(),
            "lease_expires_at": min(utc(row.expires_at), now_utc() + timedelta(minutes=5)),
            "permissions": ["downloads", "extended-catalog", "big-screen", "library"],
            "cacheable": not isinstance(row, CourtesySession),
            "access_tier": courtesy_access_tier(row) if isinstance(row, CourtesySession) else row.access_tier}
