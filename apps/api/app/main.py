"""Application composition and lifecycle; domain logic belongs in named modules."""
from __future__ import annotations
import os
import logging
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse
from sqlmodel import Session, SQLModel, select
from .database import engine, database_project_ref, verify_shared_database
from .models import User, Game, AccessEvent, ClientErrorReport
from .api_schemas import AccessKeyIssueRequest, AccessKeyRenewRequest, AccessKeyRedeemRequest, ClientErrorReportRequest
from .api_dependencies import get_session
from .admin_auth import install_admin_auth
from .admin_security import _admin_browser_access
from .access_service import now_utc
from .access_keys import ensure_access_key_schema
from .access_overrides import courtesy_access_configured
from .catalog_metadata import ensure_catalog_schema, seed_known_games
from .steam_client import steam_catalog
from .review_maintenance import _start_steam_review_importer
from .activation_routes import router as activation_router, require_active_installation, redeem_access_key, activation_status
from .access_admin_routes import router as access_admin_router, create_access_keys, list_access_keys, renew_access_key, revoke_access_key
from .client_error_routes import router as client_error_router, report_client_error, admin_client_errors_view
from .catalog_routes import router as catalog_router, CATALOG_PRODUCT_FILTER, game_summary, library_catalog, digital_game_details
from .viking_cache_routes import router as viking_cache_router

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


def seed_defaults(session: Session) -> None:
    if not session.exec(select(User)).first():
        session.add(User(username="gameaccess", credits=0))
        session.commit()


@app.on_event("startup")
def startup() -> None:
    # Root stream handlers retain failed-request DEBUG context flushed with handle().
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s %(message)s")
    if os.environ.get("GAMEACCESS_ALLOW_SQLITE_FOR_TESTS") != "1":
        verify_shared_database(engine)
    SQLModel.metadata.create_all(engine)
    ensure_access_key_schema(engine)
    ensure_catalog_schema(engine)
    with Session(engine) as session:
        seed_defaults(session)
    seed_known_games(engine)
    from .viking_cache_routes import recover_interrupted_viking_requests
    recover_interrupted_viking_requests(engine)
    _start_steam_review_importer()
    from .discovery_service import start_maintenance
    start_maintenance()


@app.on_event("shutdown")
def stop_discovery_worker():
    from .discovery_service import stop_maintenance
    stop_maintenance()


@app.get("/admin", response_class=HTMLResponse)
@app.get("/admin-console/", response_class=HTMLResponse)
def admin_home(request: Request):
    _admin_browser_access(request)
    page = Path(__file__).resolve().parents[1] / "admin" / "index.html"
    return HTMLResponse(page.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "time": now_utc(),
        "version": app.version,
        "database": engine.dialect.name,
        "database_project": database_project_ref(str(engine.url)),
        "courtesy_access_configured": courtesy_access_configured(),
    }


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

from .request_diagnostics import trace_request
app.middleware("http")(require_active_installation)
app.middleware("http")(trace_request)
for router in (activation_router, access_admin_router, client_error_router, catalog_router, viking_cache_router):
    app.include_router(router)
