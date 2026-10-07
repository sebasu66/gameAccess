from __future__ import annotations

import base64
import html
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, select

from .admin_auth import admin_authenticated, install_admin_auth
from .archive_passwords import read_archive_passwords, save_archive_passwords
from .database import DB_PATH, engine
from .steam_catalog import SteamCatalogAdapter, SteamCatalogError, SteamReviewRateLimited, steam_assets
from .access_keys import AccessKey, canonical_installation_id, ensure_access_key_schema, issue_keys, redeem_key, utc, valid_session
from .access_overrides import CourtesySession, courtesy_access_configured, redeem_courtesy_key, valid_courtesy_session
from .credential_transport import encrypt_provider_credential, encrypt_provider_download_credential
from .steam_presence import fetch_player_summaries
from .catalog_metadata import (
    CATALOG_ALLOWED_PRODUCT_TYPES,
    ensure_catalog_schema,
    get_cached_steam_metadata,
    get_cached_steam_metadata_locale,
    catalog_metadata_for_games,
    seed_known_games,
    upsert_steam_metadata,
    upsert_steam_metadata_locale,
    next_steam_review_target,
    save_steam_review_summary,
    defer_steam_review_summary,
)
from .digital_catalog import DigitalGame, load_digital_catalog_json, sync_digital_catalog

STEAM_CACHE = DB_PATH.parent / ".steam_cache"
steam_catalog = SteamCatalogAdapter(STEAM_CACHE)
_access_logger = logging.getLogger("gameaccess.access")
LEASE_IDLE_TIMEOUT_SECONDS = max(
    60, int(os.environ.get("GAMEACCESS_LEASE_IDLE_TIMEOUT_SECONDS", "600"))
)
STEAM_PRESENCE_INTERVAL_SECONDS = max(
    15, int(os.environ.get("GAMEACCESS_STEAM_PRESENCE_INTERVAL_SECONDS", "30"))
)
_ALLOWED_PRODUCT_TYPES_SQL = ", ".join(
    f"'{product_type}'" for product_type in sorted(CATALOG_ALLOWED_PRODUCT_TYPES)
)
CATALOG_PRODUCT_FILTER = text(
    "EXISTS ("
    "SELECT 1 FROM game_metadata AS catalog_metadata "
    "WHERE catalog_metadata.game_id = game.id "
    f"AND lower(coalesce(catalog_metadata.product_type, '')) IN ({_ALLOWED_PRODUCT_TYPES_SQL})"
    ") AND lower(trim(coalesce(game.name, ''))) <> ('steam ' || CAST(game.app_id AS TEXT))"
)


class AccountStatus(str, Enum):
    free = "free"
    leased = "leased"
    disabled = "disabled"


class LeaseStatus(str, Enum):
    active = "active"
    expired = "expired"
    released = "released"


class User(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    username: str = SQLField(index=True, unique=True)
    credits: int = 0


class Game(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    slug: str = SQLField(index=True, unique=True)
    name: str
    app_id: Optional[int] = SQLField(default=None, index=True)
    credit_cost_per_hour: int = 100
    active: bool = True


class ProviderAccount(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    label: str = SQLField(index=True, unique=True)
    provider: str = "steam"
    status: AccountStatus = AccountStatus.free
    notes: str = ""


class AccountGame(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    account_id: int = SQLField(foreign_key="provideraccount.id", index=True)
    game_id: int = SQLField(foreign_key="game.id", index=True)


class Lease(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    user_id: int = SQLField(foreign_key="user.id", index=True)
    game_id: int = SQLField(foreign_key="game.id", index=True)
    account_id: int = SQLField(foreign_key="provideraccount.id", index=True)
    status: LeaseStatus = LeaseStatus.active
    starts_at: datetime
    expires_at: datetime
    credits_spent: int


class LeaseCredentialGrant(SQLModel, table=True):
    lease_id: int = SQLField(primary_key=True, foreign_key="lease.id")
    installation_id: str = SQLField(index=True)
    created_at: datetime


class LeaseRuntimeState(SQLModel, table=True):
    lease_id: int = SQLField(primary_key=True, foreign_key="lease.id")
    last_presence_check_at: Optional[datetime] = None
    last_seen_online_at: Optional[datetime] = None
    idle_since: Optional[datetime] = None
    last_game_id: Optional[int] = None
    release_reason: Optional[str] = None
    released_at: Optional[datetime] = None


class AccessEvent(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    created_at: datetime = SQLField(index=True)
    installation_id: str = SQLField(index=True)
    action: str = SQLField(index=True)
    outcome: str = SQLField(index=True)
    reason: str
    game_id: Optional[int] = SQLField(default=None, index=True)
    app_id: Optional[int] = SQLField(default=None, index=True)
    lease_id: Optional[int] = SQLField(default=None, index=True)
    account_id: Optional[int] = SQLField(default=None, index=True)


class ClientErrorReport(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    installation_id: str = SQLField(index=True)
    area: str = SQLField(index=True)
    message: str
    app_id: Optional[int] = SQLField(default=None, index=True)
    lease_id: Optional[int] = SQLField(default=None, index=True)
    client_build: str = ""
    user_agent: str = ""
    created_at: datetime = SQLField(index=True)


class CreditLedger(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    user_id: int = SQLField(foreign_key="user.id", index=True)
    amount: int
    reason: str
    created_at: datetime


class LeaseRequest(BaseModel):
    game_id: int
    minutes: int = Field(default=60, ge=5, le=24 * 60)


class SteamLoginTransportRequest(BaseModel):
    client_public_key: str = Field(min_length=300, max_length=2048)


class ProviderCredentialInvalidRequest(BaseModel):
    provider_id: str = Field(min_length=1, max_length=200)
    app_id: Optional[int] = Field(default=None, ge=1)
    error_code: str = Field(default="InvalidPassword", max_length=80)


class LeaseReleaseRequest(BaseModel):
    reason: str = Field(default="client_requested_release", min_length=1, max_length=80)


class ClientErrorReportRequest(BaseModel):
    area: str = Field(default="APP", min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=8000)
    app_id: Optional[int] = Field(default=None, ge=1)
    lease_id: Optional[int] = Field(default=None, ge=1)
    client_build: str = Field(default="", max_length=120)


class CreditRequest(BaseModel):
    user_id: int
    amount: int
    reason: str = "manual"


class SeedAccountRequest(BaseModel):
    label: str
    provider: str = "steam"
    game_ids: list[int] = []
    notes: str = ""


class SyncAccountRequest(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    provider: str = "steam"
    game_ids: list[int] = []
    notes: str = ""


class SeedGameRequest(BaseModel):
    slug: str
    name: str
    app_id: Optional[int] = None
    credit_cost_per_hour: int = Field(default=100, ge=0)


class AccessKeyIssueRequest(BaseModel):
    duration_hours: Optional[int] = Field(default=None, ge=1, le=24 * 365 * 5)
    duration_months: Optional[int] = Field(default=None, ge=1, le=60)
    key_ttl_hours: int = Field(default=24, ge=1, le=24 * 30)
    count: int = Field(default=1, ge=1, le=100)


class AccessKeyRedeemRequest(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    installation_id: str = Field(min_length=36, max_length=36)


app = FastAPI(title="gameAccess API", version="0.3.0")
install_admin_auth(app)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://localhost:38148",
        "http://127.0.0.1:38148",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-Page", "X-Page-Size", "X-Total-Pages"],
)


def get_session():
    with Session(engine) as session:
        yield session


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


def _admin_browser_access(request: Request) -> None:
    if admin_authenticated(request):
        return
    configured = os.environ.get("GAMEACCESS_ADMIN_TOKEN", "")
    challenge = {"WWW-Authenticate": 'Basic realm="GameAccess client errors"'}
    if len(configured) < 32:
        raise HTTPException(503, "Client error viewer is not configured")
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Basic "):
        raise HTTPException(401, "Administrator access required", headers=challenge)
    try:
        decoded = base64.b64decode(authorization.removeprefix("Basic ").strip()).decode("utf-8")
        username, password = decoded.split(":", 1)
    except Exception as exc:
        raise HTTPException(401, "Administrator access required", headers=challenge) from exc
    if username != "admin" or not secrets.compare_digest(password, configured):
        raise HTTPException(401, "Administrator access required", headers=challenge)


_CLIENT_ERROR_SECRET_PATTERNS = (
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)(password|session[_ -]?token|activation[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+"),
    re.compile(r"(?i)(client_public_key)\s*[:=]\s*[^\s,;]+"),
)


def _sanitize_client_error_message(value: str) -> str:
    clean = re.sub(r"\s+", " ", str(value or "")).strip()
    clean = re.sub(r"(?i)C:\\Users\\[^\\\s]+", r"C:\\Users\\[user]", clean)
    for pattern in _CLIENT_ERROR_SECRET_PATTERNS:
        clean = pattern.sub("[redacted]", clean)
    return clean[:4000]


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


@app.middleware("http")
async def require_active_installation(request: Request, call_next):
    path = request.url.path
    protected = ("/catalog", "/games/", "/steam/apps/", "/steam/search", "/users/", "/leases", "/credits", "/downloads")
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


@app.post("/admin/access-keys")
def create_access_keys(req: AccessKeyIssueRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    if (req.duration_hours is None) == (req.duration_months is None):
        raise HTTPException(422, "Specify either duration_hours or duration_months")
    keys = issue_keys(
        session,
        hours=req.duration_hours,
        months=req.duration_months,
        count=req.count,
        key_ttl_hours=req.key_ttl_hours,
    )
    return {"keys": [{"id": key_id, "key": key} for key_id, key in keys]}


@app.get("/admin/access-keys")
def list_access_keys(request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    rows = session.exec(select(AccessKey).order_by(AccessKey.id.desc())).all()
    return {"keys": [{
        "id": row.id,
        "duration_hours": row.duration_hours,
        "duration_months": row.duration_months,
        "created_at": row.created_at,
        "key_expires_at": row.key_expires_at,
        "activated_at": row.activated_at,
        "expires_at": row.expires_at,
        "revoked_at": row.revoked_at,
        "installation_id": row.installation_id,
    } for row in rows]}


@app.post("/admin/access-keys/{key_id}/revoke")
def revoke_access_key(key_id: int, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    row = session.get(AccessKey, key_id)
    if row is None:
        raise HTTPException(404, "Activation key not found")
    row.revoked_at = now_utc()
    row.session_hash = None
    session.add(row)
    session.commit()
    return {"ok": True}


@app.get("/admin/access-events")
def list_access_events(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    installation_id: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    outcome: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> dict:
    _admin_activation_access(request)
    statement = select(AccessEvent)
    if installation_id:
        statement = statement.where(AccessEvent.installation_id == installation_id)
    if action:
        statement = statement.where(AccessEvent.action == action)
    if outcome:
        statement = statement.where(AccessEvent.outcome == outcome)
    rows = session.exec(statement.order_by(AccessEvent.id.desc()).limit(limit)).all()
    return {
        "events": [
            {
                "id": row.id,
                "created_at": row.created_at,
                "installation_id": row.installation_id,
                "action": row.action,
                "outcome": row.outcome,
                "reason": row.reason,
                "game_id": row.game_id,
                "app_id": row.app_id,
                "lease_id": row.lease_id,
                "account_id": row.account_id,
            }
            for row in rows
        ]
    }


@app.post("/activation/redeem")
def redeem_access_key(req: AccessKeyRedeemRequest, session: Session = Depends(get_session)) -> dict:
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
    return {"session_token": token, "installation_id": installation_id, "expires_at": expires_at}


@app.get("/activation/status")
def activation_status(request: Request, session: Session = Depends(get_session)) -> dict:
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
        raise HTTPException(401, "GameAccess activation is required or has expired")
    return {"active": True, "expires_at": utc(row.expires_at), "server_time": now_utc()}


class ArchivePasswordsRequest(BaseModel):
    passwords: str = Field(max_length=100000)


@app.get("/admin/archive-passwords")
def admin_archive_passwords(request: Request, response: Response) -> dict:
    _admin_activation_access(request)
    response.headers["Cache-Control"] = "no-store"
    passwords = read_archive_passwords()
    return {"passwords": "\n".join(passwords), "count": len(passwords)}


@app.put("/admin/archive-passwords")
def admin_save_archive_passwords(req: ArchivePasswordsRequest, request: Request, response: Response) -> dict:
    _admin_activation_access(request)
    response.headers["Cache-Control"] = "no-store"
    try:
        passwords = save_archive_passwords(req.passwords)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    return {"ok": True, "count": len(passwords)}


@app.get("/digital/archive-passwords")
def client_archive_passwords(request: Request, response: Response, session: Session = Depends(get_session)) -> dict:
    if _activation_for_request(request, session) is None:
        raise HTTPException(401, "GameAccess activation is required or has expired")
    response.headers["Cache-Control"] = "no-store"
    return {"passwords": read_archive_passwords()}


@app.post("/client-errors")
def report_client_error(
    req: ClientErrorReportRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    if _activation_for_request(request, session) is None:
        raise HTTPException(401, "GameAccess activation is required or has expired")
    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    message = _sanitize_client_error_message(req.message)
    if not message:
        raise HTTPException(422, "Client error message is empty")
    row = ClientErrorReport(
        installation_id=installation_id,
        area=re.sub(r"[^A-Za-z0-9 _.-]", "", req.area).strip()[:80] or "APP",
        message=message,
        app_id=req.app_id,
        lease_id=req.lease_id,
        client_build=req.client_build.strip()[:120],
        user_agent=request.headers.get("User-Agent", "")[:500],
        created_at=now_utc(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"ok": True, "id": row.id}


def _client_error_rows(
    session: Session,
    *,
    limit: int,
    area: str | None = None,
    installation_id: str | None = None,
) -> list[ClientErrorReport]:
    statement = select(ClientErrorReport)
    if area:
        statement = statement.where(ClientErrorReport.area == area)
    if installation_id:
        statement = statement.where(ClientErrorReport.installation_id == installation_id)
    return list(
        session.exec(
            statement.order_by(ClientErrorReport.id.desc()).limit(limit)
        ).all()
    )


@app.get("/admin/client-errors")
def admin_client_errors(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    area: str | None = Query(default=None, max_length=80),
    installation_id: str | None = Query(default=None, max_length=36),
    session: Session = Depends(get_session),
) -> dict:
    _admin_activation_access(request)
    rows = _client_error_rows(
        session,
        limit=limit,
        area=area,
        installation_id=installation_id,
    )
    return {
        "errors": [
            {
                "id": row.id,
                "created_at": row.created_at,
                "installation_id": row.installation_id,
                "area": row.area,
                "message": row.message,
                "app_id": row.app_id,
                "lease_id": row.lease_id,
                "client_build": row.client_build,
                "user_agent": row.user_agent,
            }
            for row in rows
        ]
    }


@app.get("/admin/client-errors/view", response_class=HTMLResponse)
def admin_client_errors_view(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    area: str | None = Query(default=None, max_length=80),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    _admin_browser_access(request)
    rows = _client_error_rows(session, limit=limit, area=area)
    body_rows = "".join(
        "<tr>"
        f"<td>{row.id}</td>"
        f"<td>{html.escape(row.created_at.isoformat())}</td>"
        f"<td>{html.escape(row.area)}</td>"
        f"<td>{row.app_id or ''}</td>"
        f"<td>{row.lease_id or ''}</td>"
        f"<td><code>{html.escape(row.installation_id)}</code></td>"
        f"<td>{html.escape(row.client_build or '')}</td>"
        f"<td class='message'>{html.escape(row.message)}</td>"
        "</tr>"
        for row in rows
    )
    page = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GameAccess · errores de clientes</title>
<style>
body{{font:14px system-ui,sans-serif;margin:24px;background:#111827;color:#e5e7eb}}
h1{{font-size:22px}} .meta{{color:#9ca3af;margin-bottom:18px}}
table{{width:100%;border-collapse:collapse;background:#1f2937}}
th,td{{padding:8px 10px;border-bottom:1px solid #374151;text-align:left;vertical-align:top}}
th{{position:sticky;top:0;background:#111827}} code{{font-size:11px}}
.message{{max-width:680px;white-space:pre-wrap;word-break:break-word}}
</style>
</head>
<body>
<h1>Errores de clientes GameAccess</h1>
<div class="meta">Últimos {len(rows)} reportes · más recientes primero · <a href="/health" style="color:#93c5fd">health</a></div>
<table>
<thead><tr><th>ID</th><th>Fecha UTC</th><th>Área</th><th>AppID</th><th>Lease</th><th>Instalación</th><th>Build</th><th>Error</th></tr></thead>
<tbody>{body_rows}</tbody>
</table>
</body></html>"""
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


def _lease_installation_id(session: Session, lease_id: int) -> str:
    grant = session.get(LeaseCredentialGrant, lease_id)
    return grant.installation_id if grant else ""


def _installation_access_expires_at(
    session: Session, installation_id: str
) -> datetime | None:
    """Return the latest server-known access expiry for one installation."""
    if not installation_id:
        return None
    expirations: list[datetime] = []
    for row in session.exec(
        select(AccessKey).where(
            AccessKey.installation_id == installation_id,
            AccessKey.revoked_at.is_(None),
        )
    ).all():
        if row.expires_at is not None:
            expirations.append(utc(row.expires_at))
    for row in session.exec(
        select(CourtesySession).where(
            CourtesySession.installation_id == installation_id
        )
    ).all():
        expirations.append(utc(row.expires_at))
    return max(expirations) if expirations else None


def _runtime_state(session: Session, lease_id: int) -> LeaseRuntimeState:
    runtime = session.get(LeaseRuntimeState, lease_id)
    if runtime is None:
        runtime = LeaseRuntimeState(lease_id=lease_id)
        session.add(runtime)
    return runtime


def _release_backend_lease(
    session: Session,
    lease: Lease,
    *,
    reason: str,
    status: LeaseStatus = LeaseStatus.released,
) -> None:
    if lease.status != LeaseStatus.active:
        return
    lease.status = status
    account = session.get(ProviderAccount, lease.account_id)
    other_active = session.exec(
        select(Lease).where(
            Lease.account_id == lease.account_id,
            Lease.status == LeaseStatus.active,
            Lease.id != lease.id,
        )
    ).first()
    if account and other_active is None and account.status == AccountStatus.leased:
        account.status = AccountStatus.free
        session.add(account)
    runtime = _runtime_state(session, int(lease.id))
    runtime.release_reason = reason
    runtime.released_at = now_utc()
    session.add(runtime)
    session.add(lease)
    _record_access_event(
        session,
        installation_id=_lease_installation_id(session, int(lease.id)),
        action="lease-release",
        outcome="released",
        reason=reason,
        game_id=lease.game_id,
        lease_id=int(lease.id),
        account_id=lease.account_id,
    )


def expire_old_leases(session: Session) -> None:
    """Lease hard expiry follows the activation/key expiry, never a play-time timer.

    Historical leases used expires_at as a short session timer. When a lease has
    an installation grant, normalize that old timestamp to the installation's
    actual activation expiry before deciding anything.
    """
    now = now_utc()
    leases = session.exec(select(Lease).where(Lease.status == LeaseStatus.active)).all()
    changed = False
    for lease in leases:
        installation_id = _lease_installation_id(session, int(lease.id))
        access_expires = _installation_access_expires_at(session, installation_id)
        if access_expires is not None:
            if access_expires > now:
                if utc(lease.expires_at) != access_expires:
                    lease.expires_at = access_expires
                    session.add(lease)
                    changed = True
                continue
            _release_backend_lease(
                session,
                lease,
                reason="activation_expired",
                status=LeaseStatus.expired,
            )
            changed = True
            continue

        # Ungranted legacy/test rows have no installation entitlement to derive.
        if utc(lease.expires_at) <= now:
            _release_backend_lease(
                session,
                lease,
                reason="lease_expired_without_installation_grant",
                status=LeaseStatus.expired,
            )
            changed = True
    if changed:
        session.commit()


_presence_worker_started = False


def _configured_steam_web_api_key() -> str:
    """Return the exact Render secret used for Steam presence checks."""
    return os.environ.get("STEAM_WEB_API_KEY", "").strip()


def _provider_steam_id64(account: ProviderAccount) -> str | None:
    import json

    try:
        notes = json.loads(account.notes or "{}")
    except Exception:
        return None
    raw = str(notes.get("steam_id64") or "").strip()
    return raw if raw.isdigit() else None


def _steam_presence_loop() -> None:
    missing_key_logged = False
    while True:
        api_key = _configured_steam_web_api_key()
        if not api_key:
            if not missing_key_logged:
                _access_logger.warning(
                    "Steam presence monitor disabled: STEAM_WEB_API_KEY is not configured; active leases are preserved."
                )
                missing_key_logged = True
            time.sleep(max(60, STEAM_PRESENCE_INTERVAL_SECONDS))
            continue
        missing_key_logged = False

        lease_rows: list[tuple[int, int, str]] = []
        with Session(engine) as session:
            expire_old_leases(session)
            for lease in session.exec(
                select(Lease).where(Lease.status == LeaseStatus.active)
            ).all():
                account = session.get(ProviderAccount, lease.account_id)
                steam_id64 = _provider_steam_id64(account) if account else None
                if steam_id64:
                    lease_rows.append((int(lease.id), lease.account_id, steam_id64))
                else:
                    _access_logger.warning(
                        "Presence unknown for lease %s: provider account %s has no verified steam_id64; lease preserved.",
                        lease.id,
                        lease.account_id,
                    )

        if not lease_rows:
            time.sleep(STEAM_PRESENCE_INTERVAL_SECONDS)
            continue

        steam_ids = list(dict.fromkeys(row[2] for row in lease_rows))
        try:
            presence = fetch_player_summaries(api_key, steam_ids)
        except Exception as exc:
            _access_logger.warning(
                "Steam presence check failed; no inactivity timers advanced and leases are preserved: %s",
                exc,
            )
            time.sleep(STEAM_PRESENCE_INTERVAL_SECONDS)
            continue

        now = now_utc()
        changed = False
        with Session(engine) as session:
            for lease_id, account_id, steam_id64 in lease_rows:
                lease = session.get(Lease, lease_id)
                if not lease or lease.status != LeaseStatus.active:
                    continue
                runtime = _runtime_state(session, lease_id)
                snapshot = presence.get(steam_id64)
                runtime.last_presence_check_at = now

                if snapshot is None or not snapshot.known:
                    # Unknown is not inactivity: an API/privacy/network ambiguity must not evict a player.
                    runtime.idle_since = None
                    session.add(runtime)
                    changed = True
                    _access_logger.warning(
                        "Presence unknown for active lease %s / SteamID %s; inactivity timer reset and lease preserved.",
                        lease_id,
                        steam_id64,
                    )
                    continue

                if snapshot.playing:
                    runtime.last_seen_online_at = now
                    runtime.idle_since = None
                    runtime.last_game_id = snapshot.game_id
                    session.add(runtime)
                    changed = True
                    continue

                if runtime.idle_since is None:
                    runtime.idle_since = now
                    session.add(runtime)
                    changed = True
                    _record_access_event(
                        session,
                        installation_id=_lease_installation_id(session, lease_id),
                        action="steam-presence",
                        outcome="idle-grace",
                        reason="steam_not_playing_online",
                        game_id=lease.game_id,
                        app_id=snapshot.game_id,
                        lease_id=lease_id,
                        account_id=account_id,
                    )
                    continue

                idle_since = utc(runtime.idle_since)
                if (now - idle_since).total_seconds() >= LEASE_IDLE_TIMEOUT_SECONDS:
                    _release_backend_lease(
                        session,
                        lease,
                        reason="steam_inactive_timeout",
                    )
                    changed = True

            if changed:
                session.commit()
        time.sleep(STEAM_PRESENCE_INTERVAL_SECONDS)


def _start_steam_presence_monitor() -> None:
    global _presence_worker_started
    if _presence_worker_started:
        return
    _presence_worker_started = True
    threading.Thread(
        target=_steam_presence_loop,
        name="gameaccess-steam-presence",
        daemon=True,
    ).start()



_review_worker_started = False
_sources_updater_started = False
_catalog_logger = logging.getLogger("gameaccess.catalog")


def _steam_review_import_loop() -> None:
    interval = max(2.0, float(os.environ.get("GAMEACCESS_STEAM_REVIEW_INTERVAL_SECONDS", "2.5")))
    while True:
        target = next_steam_review_target(engine)
        if target is None:
            time.sleep(300)
            continue
        game_id, app_id = target
        try:
            summary = steam_catalog.fetch_review_summary(app_id)
            save_steam_review_summary(engine, game_id, summary)
        except SteamReviewRateLimited as exc:
            # Save our place and stop on Steam throttling; a later service restart
            # can resume after the persisted retry time instead of hammering Steam.
            defer_steam_review_summary(engine, game_id, max(6 * 60 * 60, exc.retry_after))
            _catalog_logger.warning("Steam review import paused after HTTP 429; progress is saved.")
            return
        except Exception as exc:
            defer_steam_review_summary(engine, game_id, 60 * 60)
            _catalog_logger.warning("Steam review import deferred one title after an error: %s", exc)
        time.sleep(interval)


def _sources_update_loop() -> None:
    import time
    import asyncio
    import logging
    from .digital_admin_routes import sync_sources, load_cached_downloads, deduplicate_download_items, load_sources_config, _populate_catalog_bg
    
    # Wait for server startup and DB restore
    time.sleep(60)
    
    while True:
        try:
            logging.info("Running automatic background sources sync...")
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(sync_sources())
            
            cached = load_cached_downloads()
            if cached:
                cfg = load_sources_config()
                deduped_cached = deduplicate_download_items(cached, cfg)
                # Parse and populate Steam IDs
                _populate_catalog_bg(deduped_cached)
            loop.close()
            logging.info("Background sources sync completed.")
        except Exception as e:
            logging.error(f"Error in background sources update loop: {e}")
        
        # Fetch updates every 6 hours
        time.sleep(21600)

def _start_sources_updater() -> None:
    global _sources_updater_started
    if _sources_updater_started:
        return
    _sources_updater_started = True
    threading.Thread(
        target=_sources_update_loop,
        name="gameaccess-sources-updater",
        daemon=True,
    ).start()

def _start_steam_review_importer() -> None:
    global _review_worker_started
    if _review_worker_started:
        return
    _review_worker_started = True
    threading.Thread(
        target=_steam_review_import_loop,
        name="gameaccess-steam-review-import",
        daemon=True,
    ).start()



def seed_defaults(session: Session) -> None:
    if not session.exec(select(User)).first():
        session.add(User(username="demo", credits=1500))
    if not session.exec(select(Game)).first():
        session.add(
            Game(
                slug="no-mans-sky",
                name="No Man's Sky",
                app_id=275850,
                credit_cost_per_hour=100,
            )
        )
        session.add(
            Game(
                slug="cyberpunk-2077",
                name="Cyberpunk 2077",
                app_id=1091500,
                credit_cost_per_hour=150,
            )
        )
        session.add(
            Game(slug="fc", name="EA Sports FC", app_id=None, credit_cost_per_hour=180)
        )
    session.commit()


def game_capacity(session: Session, game: Game) -> tuple[int, int]:
    from . import family_capacity

    return family_capacity.game_capacity(session, game)


def game_summary(
    session: Session,
    game: Game,
    metrics: dict[int, dict] | None = None,
    catalog_metadata: dict | None = None,
) -> dict:
    from . import family_capacity

    game_id = int(game.id or 0)
    metric = (metrics or {}).get(game_id)
    if metric is None:
        total, available = game_capacity(session, game)
        demand = family_capacity.demand_fields(session, game_id)
    else:
        total = int(metric.get("total", 0))
        available = int(metric.get("available", 0))
        demand = {
            "request_count_total": int(metric.get("request_count_total", 0)),
            "successful_leases": int(metric.get("successful_leases", 0)),
            "demand_value": float(metric.get("demand_value", 1.0)),
            "price_factor": float(metric.get("price_factor", 1.0)),
            "pool_value": float(metric.get("pool_value", 1.0)),
        }
    assets = steam_assets(game.app_id)
    return {
        "id": game.id,
        "slug": game.slug,
        "name": game.name,
        "app_id": game.app_id,
        "credit_cost_per_hour": game.credit_cost_per_hour,
        "copies_total": total,
        "copies_available": available,
        "availability_state": "ready"
        if available > 0
        else ("owned-busy" if total > 0 else "unavailable"),
        **demand,
        **assets,
        **(catalog_metadata or {}),
    }


def slugify(value: str, app_id: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or f"steam-{app_id}"


@app.on_event("startup")
def startup() -> None:
    SQLModel.metadata.create_all(engine)
    from .digital_catalog import ensure_digital_source_schema
    ensure_digital_source_schema(engine)
    ensure_access_key_schema(engine)
    ensure_catalog_schema(engine)
    with Session(engine) as session:
        seed_defaults(session)
    seed_known_games(engine)
    if os.environ.get("GAMEACCESS_SYNC_DIGITAL_ON_STARTUP") == "1":
        try:
            sync_digital_catalog(engine=engine)
        except Exception:
            logging.getLogger("gameaccess.digital_catalog").exception("Startup digital catalog sync failed")
    _start_steam_review_importer()
    _start_steam_presence_monitor()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "time": now_utc(),
        "version": app.version,
        "database": engine.dialect.name,
        "courtesy_access_configured": courtesy_access_configured(),
    }


def licensed_game_ids(session: Session) -> set[int]:
    return {
        int(row.game_id)
        for row in session.exec(select(AccountGame)).all()
        if row.game_id is not None
    }


def visible_catalog_game(session: Session, game_id: int | None, *, active_only: bool = True) -> Game | None:
    if not game_id:
        return None
    statement = select(Game).where(Game.id == int(game_id), CATALOG_PRODUCT_FILTER)
    if active_only:
        statement = statement.where(Game.active == True)  # noqa: E712
    return session.exec(statement).first()


def is_game_licensed(session: Session, game_id: int | None) -> bool:
    if not game_id:
        return False
    return session.exec(
        select(AccountGame).where(AccountGame.game_id == int(game_id))
    ).first() is not None


@app.get("/catalog")
def catalog(
    response: Response,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
) -> list[dict]:
    expire_old_leases(session)
    licensed_ids = licensed_game_ids(session)
    statement = (
        select(Game)
        .where(
            Game.id.in_(licensed_ids),
            Game.active == True,  # noqa: E712
            CATALOG_PRODUCT_FILTER,
        )
        .order_by(Game.id)
    )
    total = session.exec(
        select(func.count())
        .select_from(Game)
        .where(
            Game.id.in_(licensed_ids),
            Game.active == True,  # noqa: E712
            CATALOG_PRODUCT_FILTER,
        )
    ).one()
    start = (page - 1) * page_size
    games = session.exec(statement.offset(start).limit(page_size)).all()
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Page"] = str(page)
    response.headers["X-Page-Size"] = str(page_size)
    response.headers["X-Total-Pages"] = str(
        (total + page_size - 1) // page_size if total else 0
    )
    from . import family_capacity
    page_game_ids = {int(game.id) for game in games if game.id is not None}
    metrics = family_capacity.catalog_metrics(session, page_game_ids)
    for game_id in page_game_ids:
        metrics.setdefault(
            game_id,
            {
                "total": 0,
                "available": 0,
                "request_count_total": 0,
                "successful_leases": 0,
                "demand_value": 1.0,
                "price_factor": 1.0,
                "pool_value": 1.0,
            },
        )
    catalog_metadata = catalog_metadata_for_games(
        engine,
        list(page_game_ids),
        connection=session.connection(),
    )
    return [
        game_summary(
            session,
            game,
            metrics,
            catalog_metadata.get(int(game.id or 0)),
        )
        for game in games
    ]


_availability_cache_lock = threading.Lock()
_availability_cache: tuple[float, list[dict]] | None = None
_AVAILABILITY_CACHE_SECONDS = 3.0


@app.get("/catalog/availability")
def catalog_availability(session: Session = Depends(get_session)) -> list[dict]:
    """Return only live license/demand state; static game metadata is client-cached."""
    global _availability_cache

    expire_old_leases(session)
    now = time.monotonic()
    cached = _availability_cache
    if cached is not None and now - cached[0] < _AVAILABILITY_CACHE_SECONDS:
        return cached[1]

    # Multiple desktop starts can arrive together. Only one request computes the
    # full availability snapshot; followers reuse it as soon as it is ready.
    with _availability_cache_lock:
        now = time.monotonic()
        cached = _availability_cache
        if cached is not None and now - cached[0] < _AVAILABILITY_CACHE_SECONDS:
            return cached[1]

        from . import family_capacity

        result: list[dict] | None = None
        try:
            result = family_capacity.fast_catalog_availability(session)
        except Exception:
            # Keep the proven Python implementation as a safety net if hosted
            # PostgreSQL contains malformed legacy notes or the fast query fails.
            logger.exception("Fast catalog availability failed; using Python fallback")
            session.rollback()

        if result is None:
            # SQLite/tests and unexpected PostgreSQL data use the existing
            # implementation. Avoid passing thousands of IDs because that
            # creates a huge remote IN clause.
            metrics = family_capacity.catalog_metrics(session)
            games = session.exec(
                select(Game)
                .where(
                    Game.id.in_(select(AccountGame.game_id)),
                    Game.active == True,  # noqa: E712
                    CATALOG_PRODUCT_FILTER,
                )
                .order_by(Game.id)
            ).all()

            result = []
            for game in games:
                game_id = int(game.id or 0)
                metric = metrics.get(game_id, {})
                total = int(metric.get("total", 0))
                available = int(metric.get("available", 0))
                result.append({
                    "id": game_id,
                    "app_id": game.app_id,
                    "credit_cost_per_hour": game.credit_cost_per_hour,
                    "copies_total": total,
                    "copies_available": available,
                    "availability_state": "ready" if available > 0 else ("owned-busy" if total > 0 else "unavailable"),
                    "request_count_total": int(metric.get("request_count_total", 0)),
                    "successful_leases": int(metric.get("successful_leases", 0)),
                    "demand_value": float(metric.get("demand_value", 1.0)),
                    "price_factor": float(metric.get("price_factor", 1.0)),
                    "pool_value": float(metric.get("pool_value", 1.0)),
                })
        _availability_cache = (time.monotonic(), result)
        return result


@app.get("/catalog/static/{game_id}")
def catalog_static_game(game_id: int, session: Session = Depends(get_session)) -> dict:
    """Return one static catalog record for cache repair when a new license appears."""
    game = visible_catalog_game(session, game_id)
    if not game or not is_game_licensed(session, game.id):
        raise HTTPException(404, "game not found")
    metadata = catalog_metadata_for_games(
        engine,
        [int(game.id or 0)],
        connection=session.connection(),
    )
    static_metric = {
        int(game.id or 0): {
            "total": 0,
            "available": 0,
            "request_count_total": 0,
            "successful_leases": 0,
            "demand_value": 1.0,
            "price_factor": 1.0,
            "pool_value": 1.0,
        }
    }
    return game_summary(
        session,
        game,
        static_metric,
        metadata.get(int(game.id or 0)),
    )


@app.get("/games/{game_id}/details")
def game_details(
    game_id: int,
    language: str = Query(default="spanish", min_length=2, max_length=32, pattern=r"^[A-Za-z_-]+$"),
    country: str = Query(default="ar", min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$"),
    session: Session = Depends(get_session),
) -> dict:
    game = visible_catalog_game(session, game_id)
    if not game or not is_game_licensed(session, game.id):
        raise HTTPException(404, "game not found")
    summary = game_summary(session, game)
    if not game.app_id:
        return {**summary, "steam": None, "metadata_state": "no-steam-appid"}
    language = language.casefold()
    country = country.casefold()
    cached = get_cached_steam_metadata_locale(engine, int(game.id), language, country)
    if cached is not None:
        return {**summary, "steam": cached, "metadata_state": "ready"}
    try:
        steam = steam_catalog.fetch(game.app_id, language=language, country=country)
        upsert_steam_metadata_locale(engine, int(game.id), language, country, steam)
        if language == "spanish" and country == "ar":
            upsert_steam_metadata(engine, int(game.id), steam)
        return {**summary, "steam": steam, "metadata_state": "ready"}
    except SteamCatalogError as exc:
        return {
            **summary,
            "steam": None,
            "metadata_state": "temporarily-unavailable",
            "metadata_error": str(exc),
        }


@app.get("/steam/apps/{app_id}")
def steam_app(
    app_id: int,
    force: bool = False,
    language: str = Query(default="spanish", min_length=2, max_length=32, pattern=r"^[A-Za-z_-]+$"),
    country: str = Query(default="ar", min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$"),
) -> dict:
    try:
        return steam_catalog.fetch(
            app_id,
            language=language.casefold(),
            country=country.casefold(),
            force=force,
        )
    except SteamCatalogError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/admin/games/import-steam/{app_id}")
def import_steam_game(app_id: int, session: Session = Depends(get_session)) -> dict:
    try:
        metadata = steam_catalog.fetch(app_id)
    except SteamCatalogError as exc:
        raise HTTPException(502, str(exc)) from exc

    name = str(metadata.get("name") or f"Steam {app_id}").strip()
    existing = session.exec(select(Game).where(Game.app_id == app_id)).first()
    created = existing is None
    if existing is None:
        base_slug = slugify(name, app_id)
        slug = base_slug
        suffix = 2
        while session.exec(select(Game).where(Game.slug == slug)).first():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        existing = Game(slug=slug, name=name, app_id=app_id, credit_cost_per_hour=100)
    else:
        existing.name = name
        existing.active = True
    session.add(existing)
    session.commit()
    session.refresh(existing)
    return {
        "created": created,
        "game": game_summary(session, existing),
        "steam": metadata,
    }


@app.get("/digital/catalog")
@app.get("/digital-catalog.json")
@app.get("/digital_catalog.json")
def get_digital_catalog(
    all: bool = Query(False, description="Include items without download sources"),
    session: Session = Depends(get_session),
) -> list[dict]:
    """Return the digital game list JSON stored on the server.
    By default filters out entries with empty downloadSource to ensure only downloadable items are returned to clients.
    """
    from .digital_source_policy import annotate_source_policies
    items = annotate_source_policies(load_digital_catalog_json())
    if not all:
        items = [item for item in items if str(item.get("downloadSource") or "").strip()]
    # Digital IDs are Steam AppIDs; canonical metadata uses internal Game IDs.
    # Reuse cached metadata in bounded batches, without per-game Steam requests.
    game_ids_by_app = {
        int(app_id): int(game_id)
        for game_id, app_id in session.exec(select(Game.id, Game.app_id)).all()
        if game_id is not None and app_id is not None
    }
    mapped = []
    for item in items:
        try:
            app_id = int(item.get("app_id") or item.get("id") or 0)
        except (ValueError, TypeError):
            app_id = 0
        mapped.append((item, game_ids_by_app.get(app_id)))
    game_ids = sorted({game_id for _, game_id in mapped if game_id is not None})
    metadata = {}
    for offset in range(0, len(game_ids), 400):
        metadata.update(catalog_metadata_for_games(
            session.get_bind(), game_ids[offset:offset + 400], connection=session.connection(),
        ))
    # Never modify the source cache or override installation/download commands.
    return [{**item, **metadata.get(game_id, {})} for item, game_id in mapped]


@app.get("/digital/games/{app_id}/details")
def digital_game_details(
    request: Request,
    app_id: int,
    language: str = Query(default="spanish"),
    country: str = Query(default="ar"),
    session: Session = Depends(get_session)
) -> dict:
    """Return public Steam metadata for a digital game, enforcing an active session."""
    if _activation_for_request(request, session) is None:
        raise HTTPException(401, "GameAccess activation is required or has expired")
        
    language = language.casefold()
    country = country.casefold()
    # Use the injected session instead of opening a new one
    game = session.exec(select(Game).where(Game.app_id == app_id)).first()
    if not game:
        raise HTTPException(404, "digital game metadata not found")
    cached = get_cached_steam_metadata_locale(engine, int(game.id), language, country)
    if cached:
        return {"steam": cached, "metadata_state": "ready"}
    general = get_cached_steam_metadata(engine, int(game.id))
    if general:
        return {"steam": general, "metadata_state": "ready"}
    return {"steam": None, "metadata_state": "missing"}


@app.get("/digital/source/{game_id}")
def get_digital_game_source(
    request: Request,
    game_id: int,
    name: Optional[str] = Query(None),
    session: Session = Depends(get_session)
) -> dict:
    """Find or resolve a download source for a specific digital game by ID or game name."""
    if _activation_for_request(request, session) is None:
        raise HTTPException(401, "GameAccess activation is required or has expired")
    
    items = load_digital_catalog_json()
    for item in items:
        if item.get("id") == game_id:
            src = str(item.get("downloadSource") or "").strip()
            if src:
                from .digital_source_policy import annotate_source_policies
                return annotate_source_policies([{"ok": True, "id": game_id, "name": item.get("name"), "uri": src}])[0]
            if not name:
                name = item.get("name")

    # If not directly defined on catalog item, attempt matching cached Hydra sources if name is known
    if name:
        from .digital_admin_routes import load_cached_downloads, calculate_match_score
        cached = load_cached_downloads()
        scored = []
        for c in cached:
            score = calculate_match_score(name, c.get("raw_title", ""))
            if score >= 0.55:
                scored.append((score, c))
        if scored:
            scored.sort(key=lambda x: (x[0], x[1].get("upload_date", "")), reverse=True)
            best = scored[0][1]
            from .digital_source_policy import annotate_source_policies
            return annotate_source_policies([{"ok": True, "id": game_id, "name": name, "uri": best.get("uri"), "source_url": best.get("source_url"), "size": best.get("file_size")}])[0]

    raise HTTPException(404, detail="No download source found for this game")


@app.post("/admin/catalog/digital/sync")
def sync_digital_catalog_endpoint(
    request: Request,
    force: bool = False,
    reviews: bool = False,
) -> dict:
    """Sync digital catalog JSON with Steam store details in the database."""
    _admin_activation_access(request)
    return sync_digital_catalog(engine=engine, force=force, fetch_reviews=reviews)


@app.get("/users/{user_id}")
def get_user(user_id: int, session: Session = Depends(get_session)) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(404, "user not found")
    return user


@app.post("/credits")
def add_credits(req: CreditRequest, session: Session = Depends(get_session)) -> dict:
    user = session.get(User, req.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    user.credits += req.amount
    session.add(user)
    session.add(
        CreditLedger(
            user_id=user.id, amount=req.amount, reason=req.reason, created_at=now_utc()
        )
    )
    session.commit()
    session.refresh(user)
    return {"user_id": user.id, "credits": user.credits}


@app.post("/admin/games")
def add_game(req: SeedGameRequest, session: Session = Depends(get_session)) -> Game:
    existing = session.exec(select(Game).where(Game.slug == req.slug)).first()
    if existing:
        raise HTTPException(409, "game slug already exists")
    game = Game(**req.model_dump())
    session.add(game)
    session.commit()
    session.refresh(game)
    return game


@app.post("/admin/accounts")
def add_account(
    req: SeedAccountRequest, session: Session = Depends(get_session)
) -> ProviderAccount:
    existing = session.exec(
        select(ProviderAccount).where(ProviderAccount.label == req.label)
    ).first()
    if existing:
        raise HTTPException(409, "account label already exists")
    account = ProviderAccount(label=req.label, provider=req.provider, notes=req.notes)
    session.add(account)
    session.commit()
    session.refresh(account)
    for game_id in req.game_ids:
        if not visible_catalog_game(session, game_id, active_only=False):
            raise HTTPException(400, f"unknown game_id {game_id}")
        session.add(AccountGame(account_id=account.id, game_id=game_id))
    session.commit()
    return account


@app.post("/admin/accounts/sync")
def sync_account(
    req: SyncAccountRequest, session: Session = Depends(get_session)
) -> dict:
    import json

    label = req.label.strip()
    normalized_game_ids = list(dict.fromkeys(req.game_ids))
    for game_id in normalized_game_ids:
        if not visible_catalog_game(session, game_id, active_only=False):
            raise HTTPException(400, f"unknown game_id {game_id}")

    def parsed_notes(value: str) -> dict:
        try:
            parsed = json.loads(value or "{}")
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}

    incoming = parsed_notes(req.notes)
    target_identities = {
        value.strip().casefold()
        for value in (
            label,
            str(incoming.get("account_name") or ""),
            str(incoming.get("provider_id") or ""),
        )
        if value.strip()
    }

    accounts = session.exec(select(ProviderAccount).order_by(ProviderAccount.id)).all()
    account = next((row for row in accounts if row.label == label), None)
    if account is None:
        for row in accounts:
            previous = parsed_notes(row.notes)
            identities = {
                str(row.label or "").split("#", 1)[0].strip().casefold(),
                str(previous.get("account_name") or "").strip().casefold(),
                str(previous.get("provider_id") or "").strip().casefold(),
            }
            if target_identities & {value for value in identities if value}:
                account = row
                break

    created = account is None
    if account is None:
        account = ProviderAccount(label=label, provider=req.provider, notes="{}")
        session.add(account)
        session.commit()
        session.refresh(account)

    previous = parsed_notes(account.notes)
    credential_status = str(incoming.get("credential_status") or "").strip().casefold()
    if credential_status == "invalid_password":
        account.status = AccountStatus.disabled
    elif credential_status == "valid" and account.status == AccountStatus.disabled:
        account.status = AccountStatus.free

    # Keep one canonical label for this Steam login whenever it is safe.
    if account.label != label:
        conflict = session.exec(
            select(ProviderAccount).where(
                ProviderAccount.label == label,
                ProviderAccount.id != account.id,
            )
        ).first()
        if conflict is None:
            account.label = label

    incoming["disabled_by_inventory_scan"] = False
    account.provider = req.provider
    account.notes = json.dumps({**previous, **incoming}, ensure_ascii=False)
    session.add(account)

    mappings = session.exec(
        select(AccountGame).where(AccountGame.account_id == account.id)
    ).all()
    by_game = {row.game_id: row for row in mappings}

    authoritative = incoming.get("inventory_complete") is True or not incoming
    if authoritative:
        desired = set(normalized_game_ids)
        for game_id, row in by_game.items():
            if game_id not in desired:
                session.delete(row)
        for game_id in normalized_game_ids:
            if game_id not in by_game:
                session.add(AccountGame(account_id=account.id, game_id=game_id))

    session.commit()
    session.refresh(account)
    final_mappings = session.exec(
        select(AccountGame).where(AccountGame.account_id == account.id)
    ).all()
    return {
        "ok": True,
        "created": created,
        "account": {
            "id": account.id,
            "label": account.label,
            "provider": account.provider,
            "status": account.status,
            "game_ids": sorted({int(row.game_id) for row in final_mappings}),
        },
    }


@app.get("/admin/accounts")
def list_accounts(session: Session = Depends(get_session)) -> list[dict]:
    expire_old_leases(session)
    accounts = session.exec(select(ProviderAccount)).all()
    result = []
    for account in accounts:
        rows = session.exec(
            select(AccountGame).where(AccountGame.account_id == account.id)
        ).all()
        games = session.exec(
            select(Game).where(
                Game.id.in_([row.game_id for row in rows]),
                CATALOG_PRODUCT_FILTER,
            )
        ).all() if rows else []
        result.append(
            {
                "id": account.id,
                "label": account.label,
                "provider": account.provider,
                "status": account.status,
                "games": [{"id": g.id, "name": g.name} for g in games if g],
                "notes": account.notes,
            }
        )
    return result


@app.post("/leases")
def create_lease(
    req: LeaseRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    activation = _activation_for_request(request, session)
    if activation is None:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play",
            reason="activation_missing_or_expired",
            status_code=401,
            user_message="Tu tiempo de acceso terminó. Ingresa una nueva llave para continuar.",
            game_id=req.game_id,
        )
    expire_old_leases(session)

    game = visible_catalog_game(session, req.game_id)
    if not game or not is_game_licensed(session, req.game_id):
        _reject_access(
            session,
            installation_id=installation_id,
            action="play",
            reason="game_not_in_gameaccess_catalog",
            status_code=404,
            user_message="Este juego no está disponible actualmente en Game Access.",
            game_id=req.game_id,
        )

    user = session.exec(select(User).order_by(User.id)).first()
    if not user:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play",
            reason="backend_user_record_missing",
            status_code=503,
            user_message="Game Access no pudo preparar el acceso en este momento.",
            game_id=req.game_id,
        )

    activation_expires = utc(activation.expires_at)
    current = session.exec(
        select(Lease)
        .join(LeaseCredentialGrant, LeaseCredentialGrant.lease_id == Lease.id)
        .where(
            LeaseCredentialGrant.installation_id == installation_id,
            Lease.status == LeaseStatus.active,
        )
        .order_by(Lease.starts_at.desc())
    ).first()

    from . import family_capacity

    if current:
        current_account = session.get(ProviderAccount, current.account_id)
        if (
            current_account
            and family_capacity.account_credential_usable(current_account)
            and family_capacity.account_can_access_game(session, current_account, game)
        ):
            current.expires_at = activation_expires
            runtime = _runtime_state(session, int(current.id))
            runtime.release_reason = None
            runtime.released_at = None
            session.add(current)
            session.add(runtime)
            demand = family_capacity.record_successful_lease(session, int(game.id))
            _record_access_event(
                session,
                installation_id=installation_id,
                action="play",
                outcome="allowed",
                reason="reused_same_installation_account",
                game_id=int(game.id),
                app_id=game.app_id,
                lease_id=int(current.id),
                account_id=current.account_id,
            )
            session.commit()
            return {
                "lease_id": current.id,
                "user_id": current.user_id,
                "game": {"id": game.id, "name": game.name, "app_id": game.app_id},
                "account": {
                    "id": current_account.id,
                    "label": current_account.label,
                    "provider": current_account.provider,
                },
                "demand": {
                    "request_count_total": demand.request_count_total,
                    "successful_leases": demand.successful_leases,
                    "demand_value": demand.demand_value,
                    "price_factor": demand.price_factor,
                    "pool_value": round(demand.demand_value * demand.price_factor, 4),
                },
                "starts_at": current.starts_at,
                "expires_at": activation_expires,
                "credits_spent": current.credits_spent,
                "credits_remaining": user.credits,
                "session_action": "provider_adapter_required",
                "reused": True,
            }

    selection = family_capacity.select_best_account(session, game)
    if not selection:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play",
            reason="no_free_verified_account_for_game",
            status_code=409,
            user_message="Todas las cuentas que pueden abrir este juego están ocupadas en este momento.",
            game_id=int(game.id),
            app_id=game.app_id,
        )
    selected = selection["account"]

    # Only replace the caller's old lease after a valid replacement exists.
    if current:
        _release_backend_lease(
            session,
            current,
            reason="replaced_by_same_installation",
        )

    cost = 0
    starts = now_utc()
    lease = Lease(
        user_id=int(user.id),
        game_id=int(game.id),
        account_id=int(selected.id),
        starts_at=starts,
        expires_at=activation_expires,
        credits_spent=cost,
    )
    selected.status = AccountStatus.leased
    user.credits -= cost
    session.add_all([selected, user, lease])
    session.add(
        CreditLedger(
            user_id=int(user.id),
            amount=-cost,
            reason=f"lease:{game.slug}",
            created_at=starts,
        )
    )
    session.commit()
    session.refresh(lease)
    session.add(
        LeaseCredentialGrant(
            lease_id=int(lease.id),
            installation_id=installation_id,
            created_at=starts,
        )
    )
    session.add(LeaseRuntimeState(lease_id=int(lease.id)))
    demand = family_capacity.record_successful_lease(session, int(game.id))
    _record_access_event(
        session,
        installation_id=installation_id,
        action="play",
        outcome="allowed",
        reason="new_provider_account_assigned",
        game_id=int(game.id),
        app_id=game.app_id,
        lease_id=int(lease.id),
        account_id=int(selected.id),
    )
    session.commit()
    return {
        "lease_id": lease.id,
        "user_id": user.id,
        "game": {"id": game.id, "name": game.name, "app_id": game.app_id},
        "account": {
            "id": selected.id,
            "label": selected.label,
            "provider": selected.provider,
        },
        "demand": {
            "request_count_total": demand.request_count_total,
            "successful_leases": demand.successful_leases,
            "demand_value": demand.demand_value,
            "price_factor": demand.price_factor,
            "pool_value": round(demand.demand_value * demand.price_factor, 4),
        },
        "starts_at": starts,
        "expires_at": activation_expires,
        "credits_spent": cost,
        "credits_remaining": user.credits,
        "session_action": "provider_adapter_required",
        "reused": False,
    }


def _download_account_for_app(session: Session, app_id: int) -> ProviderAccount | None:
    """Choose any usable registered provider with known access; leases do not block download."""
    from .account_roster import credential_for_label
    from . import family_capacity

    game = session.exec(select(Game).where(Game.app_id == app_id)).first()
    if game is None:
        return None

    seen: set[str] = set()
    for account in session.exec(select(ProviderAccount).order_by(ProviderAccount.id)).all():
        if not family_capacity.account_credential_usable(account):
            continue
        identity = family_capacity.account_identity(account) or f"account:{account.id}"
        if identity in seen:
            continue
        seen.add(identity)
        if not family_capacity.account_can_access_game(session, account, game):
            continue
        if credential_for_label(account.label):
            return account
    return None


@app.post("/downloads/provider-credential-invalid")
def report_provider_invalid_password(
    req: ProviderCredentialInvalidRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    import json

    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    if req.error_code.casefold() != "invalidpassword":
        _reject_access(
            session,
            installation_id=installation_id,
            action="provider-credential",
            reason="unsupported_credential_failure_report",
            status_code=400,
            user_message="El reporte de credencial no es válido.",
            app_id=req.app_id,
        )

    from . import family_capacity

    provider_identity = req.provider_id.strip().casefold()
    affected: list[int] = []
    for account in session.exec(
        select(ProviderAccount).order_by(ProviderAccount.id)
    ).all():
        if family_capacity.account_identity(account) != provider_identity:
            continue
        try:
            notes = json.loads(account.notes or "{}")
            if not isinstance(notes, dict):
                notes = {}
        except Exception:
            notes = {}
        notes["credential_status"] = "invalid_password"
        notes["credential_error"] = "InvalidPassword"
        notes["credential_invalidated_at"] = now_utc().isoformat()
        account.status = AccountStatus.disabled
        account.notes = json.dumps(notes, ensure_ascii=False)
        session.add(account)
        affected.append(int(account.id))

    if not affected:
        _record_access_event(
            session,
            installation_id=installation_id,
            action="provider-credential",
            outcome="ignored",
            reason="provider_identity_not_found",
            app_id=req.app_id,
            commit=True,
        )
        return {"ok": True, "affected": 0}

    for account_id in affected:
        _record_access_event(
            session,
            installation_id=installation_id,
            action="provider-credential",
            outcome="disabled",
            reason="steam_invalid_password_during_download",
            app_id=req.app_id,
            account_id=account_id,
        )
    session.commit()
    return {"ok": True, "affected": len(affected)}


@app.post("/downloads/{app_id}/steam-login")
def download_steam_login(
    app_id: int,
    req: SteamLoginTransportRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response:
    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    if _activation_for_request(request, session) is None:
        _reject_access(
            session,
            installation_id=installation_id,
            action="download",
            reason="activation_missing_or_expired",
            status_code=401,
            user_message="Tu tiempo de acceso terminó. Ingresa una nueva llave para continuar.",
            app_id=app_id,
        )

    game = session.exec(
        select(Game).where(Game.app_id == app_id, Game.active == True)  # noqa: E712
    ).first()
    if not game:
        _reject_access(
            session,
            installation_id=installation_id,
            action="download",
            reason="game_not_in_active_catalog",
            status_code=404,
            user_message="Este juego no está disponible actualmente en Game Access.",
            app_id=app_id,
        )

    account = _download_account_for_app(session, app_id)
    if account is None:
        _reject_access(
            session,
            installation_id=installation_id,
            action="download",
            reason="no_registered_account_reports_access",
            status_code=409,
            user_message="No encontramos una cuenta registrada que pueda descargar este juego.",
            game_id=int(game.id),
            app_id=app_id,
        )

    from .account_roster import credential_for_label
    import json

    credential = credential_for_label(account.label)
    if not credential:
        _reject_access(
            session,
            installation_id=installation_id,
            action="download",
            reason="provider_credentials_unavailable",
            status_code=409,
            user_message="La cuenta elegida no está lista para iniciar la descarga. Intenta nuevamente.",
            game_id=int(game.id),
            app_id=app_id,
            account_id=int(account.id),
        )
    notes = json.loads(account.notes or "{}")
    expected = notes.get("user_id32")
    if not expected and notes.get("steam_id64"):
        expected = int(notes["steam_id64"]) - 76561197960265728
    if not expected:
        _reject_access(
            session,
            installation_id=installation_id,
            action="download",
            reason="provider_steam_identity_unverified",
            status_code=409,
            user_message="La identidad Steam de esta cuenta todavía no está verificada. Intenta nuevamente.",
            game_id=int(game.id),
            app_id=app_id,
            account_id=int(account.id),
        )

    try:
        envelope = encrypt_provider_download_credential(
            req.client_public_key,
            app_id=app_id,
            installation_id=installation_id,
            provider_id=account.label,
            account_name=credential.login,
            password=credential.password,
            expected_user_id32=int(expected),
        )
    except ValueError:
        _reject_access(
            session,
            installation_id=installation_id,
            action="download",
            reason="credential_envelope_rejected",
            status_code=400,
            user_message="No pudimos preparar el inicio de sesión para la descarga. Intenta nuevamente.",
            game_id=int(game.id),
            app_id=app_id,
            account_id=int(account.id),
        )
    _record_access_event(
        session,
        installation_id=installation_id,
        action="download",
        outcome="allowed",
        reason="provider_credentials_issued",
        game_id=int(game.id),
        app_id=app_id,
        account_id=int(account.id),
        commit=True,
    )
    return JSONResponse(envelope, headers={"Cache-Control": "no-store"})


@app.post("/leases/{lease_id}/steam-login")
def lease_steam_login(
    lease_id: int,
    req: SteamLoginTransportRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> Response:
    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    activation = _activation_for_request(request, session)
    if activation is None:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play-login",
            reason="activation_missing_or_expired",
            status_code=401,
            user_message="Tu tiempo de acceso terminó. Ingresa una nueva llave para continuar.",
            lease_id=lease_id,
        )
    lease = session.get(Lease, lease_id)
    if not lease or lease.status != LeaseStatus.active:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play-login",
            reason="lease_not_active",
            status_code=409,
            user_message="Esta reserva ya no está activa. Vuelve a pulsar Jugar para obtener acceso.",
            lease_id=lease_id,
        )
    grant = session.get(LeaseCredentialGrant, lease_id)
    if not grant or grant.installation_id != installation_id:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play-login",
            reason="lease_owned_by_other_installation",
            status_code=403,
            user_message="Esta reserva pertenece a otra instalación de Game Access.",
            lease_id=lease_id,
            account_id=lease.account_id,
        )
    activation_expires = utc(activation.expires_at)
    if utc(lease.expires_at) != activation_expires:
        lease.expires_at = activation_expires
        session.add(lease)
        session.commit()
    account = session.get(ProviderAccount, lease.account_id)
    from .account_roster import credential_for_label
    import json

    credential = credential_for_label(account.label) if account else None
    if not credential:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play-login",
            reason="provider_credentials_unavailable",
            status_code=409,
            user_message="La cuenta asignada no está lista para iniciar sesión. Intenta nuevamente.",
            game_id=lease.game_id,
            lease_id=lease_id,
            account_id=lease.account_id,
        )
    notes = json.loads(account.notes or "{}")
    expected = notes.get("user_id32")
    if not expected and notes.get("steam_id64"):
        expected = int(notes["steam_id64"]) - 76561197960265728
    if not expected:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play-login",
            reason="provider_steam_identity_unverified",
            status_code=409,
            user_message="La identidad Steam de la cuenta asignada todavía no está verificada.",
            game_id=lease.game_id,
            lease_id=lease_id,
            account_id=lease.account_id,
        )
    try:
        envelope = encrypt_provider_credential(
            req.client_public_key,
            lease_id=lease_id,
            installation_id=installation_id,
            account_name=credential.login,
            password=credential.password,
            expected_user_id32=int(expected),
        )
    except ValueError:
        _reject_access(
            session,
            installation_id=installation_id,
            action="play-login",
            reason="credential_envelope_rejected",
            status_code=400,
            user_message="No pudimos preparar el inicio de sesión. Intenta nuevamente.",
            game_id=lease.game_id,
            lease_id=lease_id,
            account_id=lease.account_id,
        )
    _record_access_event(
        session,
        installation_id=installation_id,
        action="play-login",
        outcome="allowed",
        reason="provider_credentials_issued",
        game_id=lease.game_id,
        lease_id=lease_id,
        account_id=lease.account_id,
        commit=True,
    )
    return JSONResponse(
        envelope,
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )


@app.get("/leases/{lease_id}")
def get_lease(
    lease_id: int,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    expire_old_leases(session)
    lease = session.get(Lease, lease_id)
    if not lease:
        _reject_access(
            session,
            installation_id=installation_id,
            action="lease-status",
            reason="lease_not_found",
            status_code=404,
            user_message="La reserva ya no existe.",
            lease_id=lease_id,
        )
    grant = session.get(LeaseCredentialGrant, lease_id)
    if not grant or grant.installation_id != installation_id:
        _reject_access(
            session,
            installation_id=installation_id,
            action="lease-status",
            reason="lease_owned_by_other_installation",
            status_code=403,
            user_message="Esta reserva pertenece a otra instalación de Game Access.",
            lease_id=lease_id,
        )
    game = visible_catalog_game(session, lease.game_id, active_only=False)
    account = session.get(ProviderAccount, lease.account_id)
    runtime = session.get(LeaseRuntimeState, lease_id)
    return {
        "id": lease.id,
        "status": lease.status,
        "user_id": lease.user_id,
        "game": game.name if game else None,
        "account_label": account.label if account else None,
        "starts_at": lease.starts_at,
        "expires_at": lease.expires_at,
        "credits_spent": lease.credits_spent,
        "release_reason": runtime.release_reason if runtime else None,
        "idle_since": runtime.idle_since if runtime else None,
        "last_seen_online_at": runtime.last_seen_online_at if runtime else None,
    }


@app.post("/leases/{lease_id}/release")
def release_lease(
    lease_id: int,
    request: Request,
    req: LeaseReleaseRequest | None = None,
    session: Session = Depends(get_session),
) -> dict:
    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    lease = session.get(Lease, lease_id)
    if not lease:
        _reject_access(
            session,
            installation_id=installation_id,
            action="lease-release",
            reason="lease_not_found",
            status_code=404,
            user_message="La reserva ya no existe.",
            lease_id=lease_id,
        )
    grant = session.get(LeaseCredentialGrant, lease_id)
    if not grant or grant.installation_id != installation_id:
        _reject_access(
            session,
            installation_id=installation_id,
            action="lease-release",
            reason="lease_owned_by_other_installation",
            status_code=403,
            user_message="Esta reserva pertenece a otra instalación de Game Access.",
            lease_id=lease_id,
        )
    runtime = session.get(LeaseRuntimeState, lease_id)
    if lease.status != LeaseStatus.active:
        return {
            "ok": True,
            "status": lease.status,
            "release_reason": runtime.release_reason if runtime else None,
        }
    allowed_reasons = {
        "client_requested_release",
        "provider_profile_missing",
        "provider_login_failed",
        "provider_invalid_password",
        "play_launch_failed",
        "download_install_handoff_complete",
    }
    requested_reason = req.reason if req else "client_requested_release"
    reason = requested_reason if requested_reason in allowed_reasons else "client_requested_release"
    if reason == "provider_invalid_password":
        import json

        account = session.get(ProviderAccount, lease.account_id)
        if account is not None:
            try:
                notes = json.loads(account.notes or "{}")
                if not isinstance(notes, dict):
                    notes = {}
            except Exception:
                notes = {}
            notes["credential_status"] = "invalid_password"
            notes["credential_error"] = "InvalidPassword"
            notes["credential_invalidated_at"] = now_utc().isoformat()
            account.status = AccountStatus.disabled
            account.notes = json.dumps(notes, ensure_ascii=False)
            session.add(account)
            _record_access_event(
                session,
                installation_id=installation_id,
                action="provider-credential",
                outcome="disabled",
                reason="steam_invalid_password",
                game_id=lease.game_id,
                lease_id=lease_id,
                account_id=lease.account_id,
            )
    _release_backend_lease(session, lease, reason=reason)
    session.commit()
    runtime = session.get(LeaseRuntimeState, lease_id)
    return {
        "ok": True,
        "status": lease.status,
        "release_reason": runtime.release_reason if runtime else reason,
    }


from .pool_routes import (  # noqa: E402 - routes import initialized app
    router as pool_router,
)

app.include_router(pool_router)

from .steam_search_routes import (  # noqa: E402 - routes import initialized app
    router as steam_search_router,
)

app.include_router(steam_search_router)

from .admin_console_routes import (  # noqa: E402 - routes import initialized app
    router as admin_console_router,
    admin_console,
)

app.include_router(admin_console_router)
app.add_api_route("/admin", admin_console, methods=["GET"], include_in_schema=False)
app.add_api_route("/admin/", admin_console, methods=["GET"], include_in_schema=False)

from .digital_admin_routes import (  # noqa: E402
    router as digital_admin_router,
    get_digital_admin_page,
)

app.include_router(digital_admin_router)
app.add_api_route("/admin/digital", get_digital_admin_page, methods=["GET"], include_in_schema=False)
app.add_api_route("/admin/digital/", get_digital_admin_page, methods=["GET"], include_in_schema=False)
