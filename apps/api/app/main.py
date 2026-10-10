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
from pathlib import Path
from typing import Literal, Optional

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
from .access_keys import AccessKey, canonical_installation_id, ensure_access_key_schema, issue_keys, redeem_key, session_end_details, utc, valid_session
from .access_overrides import CourtesySession, courtesy_access_tier, courtesy_access_configured, redeem_courtesy_key, valid_courtesy_session
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

STEAM_CACHE = DB_PATH.parent / ".steam_cache"
steam_catalog = SteamCatalogAdapter(STEAM_CACHE)
_access_logger = logging.getLogger("gameaccess.access")
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


class ClientErrorReportRequest(BaseModel):
    area: str = Field(default="APP", min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=8000)
    app_id: Optional[int] = Field(default=None, ge=1)
    lease_id: Optional[int] = Field(default=None, ge=1)
    client_build: str = Field(default="", max_length=120)


class AccessKeyIssueRequest(BaseModel):
    expires_at: Optional[datetime] = None
    access_tier: Optional[Literal["base", "plus"]] = None
    duration_hours: Optional[int] = Field(default=None, ge=1, le=24 * 365 * 5)
    duration_months: Optional[int] = Field(default=None, ge=1, le=60)
    key_ttl_hours: int = Field(default=24, ge=1, le=24 * 30)
    count: int = Field(default=1, ge=1, le=100)


class AccessKeyRenewRequest(BaseModel):
    expires_at: datetime


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
    protected = ("/catalog", "/games/", "/steam/apps/", "/steam/search", "/users/")
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
    if sum(value is not None for value in (req.duration_hours, req.duration_months, req.expires_at)) != 1:
        raise HTTPException(422, "Specify exactly one expires_at, duration_hours or duration_months")
    if req.expires_at is not None and (req.expires_at.tzinfo is None or req.expires_at.utcoffset() is None or utc(req.expires_at) <= now_utc()):
        raise HTTPException(422, "Expiry must be a future date with a timezone")
    keys = issue_keys(
        session,
        hours=req.duration_hours,
        months=req.duration_months,
        count=req.count,
        key_ttl_hours=req.key_ttl_hours,
        expires_at=req.expires_at,
        access_tier=req.access_tier,
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
        "access_tier": row.access_tier,
        "created_at": row.created_at,
        "key_expires_at": row.key_expires_at,
        "activated_at": row.activated_at,
        "expires_at": row.expires_at,
        "revoked_at": row.revoked_at,
        "installation_id": row.installation_id,
    } for row in rows]}


@app.post("/admin/access-keys/{key_id}/renew")
def renew_access_key(key_id: int, req: AccessKeyRenewRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    if req.expires_at.tzinfo is None or req.expires_at.utcoffset() is None or utc(req.expires_at) <= now_utc():
        raise HTTPException(422, "Expiry must be a future date with a timezone")
    row = session.get(AccessKey, key_id)
    if row is None:
        raise HTTPException(404, "Activation key not found")
    if row.revoked_at is not None:
        raise HTTPException(409, "A revoked key cannot be renewed")
    if row.access_tier != "plus":
        raise HTTPException(409, "Manual payment renewal is only available for PLUS")
    target = utc(req.expires_at)
    if row.expires_at is not None and target <= utc(row.expires_at):
        raise HTTPException(409, "Renewal must extend the current expiry")
    row.expires_at = target
    if row.activated_at is None:
        row.key_expires_at = target
    session.add(row)
    session.commit()
    return {"id": row.id, "access_tier": row.access_tier, "expires_at": utc(row.expires_at)}


@app.post("/admin/access-keys/{key_id}/revoke")
def revoke_access_key(key_id: int, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    row = session.get(AccessKey, key_id)
    if row is None:
        raise HTTPException(404, "Activation key not found")
    row.revoked_at = now_utc()
    # Retain the digest for authenticated rejection metadata; revoked_at still
    # denies all access through valid_session and redeem_key.
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
def redeem_access_key(req: AccessKeyRedeemRequest, session: Session = Depends(get_session), response: Response = None) -> dict:
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
    return {"session_token": token, "installation_id": installation_id, "expires_at": expires_at,
            "cacheable": courtesy is None,
            "access_tier": courtesy_access_tier(row) if courtesy is not None else row.access_tier}


@app.get("/activation/status")
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
    return {"active": True, "expires_at": utc(row.expires_at), "server_time": now_utc(),
            "cacheable": not isinstance(row, CourtesySession),
            "access_tier": courtesy_access_tier(row) if isinstance(row, CourtesySession) else row.access_tier}


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


_review_worker_started = False
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
        session.add(User(username="gameaccess", credits=0))
        session.commit()


def game_summary(session: Session, game: Game, catalog_metadata: dict | None = None) -> dict:
    data = catalog_metadata or catalog_metadata_for_games(engine, [int(game.id)], connection=session.connection()).get(int(game.id), {})
    return {**data, "id": game.app_id, "app_id": game.app_id, "slug": game.slug, "name": game.name,
            "credit_cost_per_hour": 0, "copies_total": 0, "copies_available": 0}


def slugify(value: str, app_id: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or f"steam-{app_id}"


@app.on_event("startup")
def startup() -> None:
    SQLModel.metadata.create_all(engine)
    ensure_access_key_schema(engine)
    ensure_catalog_schema(engine)
    with Session(engine) as session:
        seed_defaults(session)
    seed_known_games(engine)
    _start_steam_review_importer()
    from .discovery_service import start_maintenance
    start_maintenance()


@app.on_event("shutdown")
def stop_discovery_worker():
    from .discovery_service import stop_maintenance
    stop_maintenance()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "time": now_utc(),
        "version": app.version,
        "database": engine.dialect.name,
        "courtesy_access_configured": courtesy_access_configured(),
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


@app.get("/catalog")
@app.get("/library/catalog")
def library_catalog(session: Session = Depends(get_session)) -> list[dict]:
    """Public game metadata, independent of licenses and external download lists."""
    games = session.exec(
        select(Game).where(
            Game.active == True,  # noqa: E712
            Game.app_id.is_not(None),
            CATALOG_PRODUCT_FILTER,
        ).order_by(Game.id)
    ).all()
    metadata = {}
    ids = [int(game.id) for game in games]
    for start in range(0, len(ids), 400):
        metadata.update(catalog_metadata_for_games(
            engine, ids[start:start + 400], connection=session.connection(),
        ))
    database_games = [{
        **metadata.get(int(game.id), {}),
        "id": game.app_id, "app_id": game.app_id,
        "name": game.name, "slug": game.slug,
        "credit_cost_per_hour": 0, "copies_total": 0, "copies_available": 0,
    } for game in games]
    from .discovery_service import catalog_games
    by_app = {row["app_id"]: row for row in catalog_games()}
    for row in database_games:
        base = by_app.get(row["app_id"], {})
        merged = {**base, **{key: value for key, value in row.items() if value is not None and value != "" and value != []}}
        for key in ("tags", "genres", "categories"):
            merged[key] = sorted(set(base.get(key, [])) | set(row.get(key, [])))
        by_app[row["app_id"]] = merged
    return list(by_app.values())


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


@app.get("/users/{user_id}")
def get_user(user_id: int, session: Session = Depends(get_session)) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(404, "user not found")
    return user


from .steam_search_routes import router as steam_search_router
from .resolver_routes import router as resolver_router
from .linkvertise_access import router as linkvertise_access_router
from .discovery_service import router as discovery_router
from .cooptimus import router as cooptimus_router
app.include_router(steam_search_router)
app.include_router(resolver_router)
app.include_router(linkvertise_access_router)
app.include_router(discovery_router)
app.include_router(cooptimus_router)
