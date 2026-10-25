"""Application composition and lifecycle; domain logic belongs in named modules."""
from __future__ import annotations
import os
import logging
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, Response
from sqlmodel import Session, SQLModel, select
from .database import engine, database_project_ref, verify_shared_database
from .local_database import LOCAL_TABLE_NAMES, create_local_tables, local_engine
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
from .viking_chunk_routes import router as viking_chunk_router
from .admin_dashboard_routes import router as admin_dashboard_router
from . import resource_governor

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
# Outermost: counts every response as it leaves the server (after compression) for the month's traffic budget.
app.add_middleware(resource_governor.TrafficCounter)


def seed_defaults(session: Session) -> None:
    if not session.exec(select(User)).first():
        session.add(User(username="gameaccess", credits=0))
        session.commit()


@app.on_event("startup")
def startup() -> None:
    # Root stream handlers retain failed-request DEBUG context flushed with handle().
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s %(message)s")
    # httpx logs each request URL at INFO and TorBox calls carry the API token in the query string.
    for noisy_logger in ("httpx", "httpcore"):
        logging.getLogger(noisy_logger).setLevel(logging.WARNING)
    if os.environ.get("GAMEACCESS_ALLOW_SQLITE_FOR_TESTS") != "1":
        verify_shared_database(engine)
    # The chunk-download/telemetry tables live in their own local SQLite file (local_database.py), not here.
    SQLModel.metadata.create_all(engine, tables=[t for t in SQLModel.metadata.tables.values() if t.name not in LOCAL_TABLE_NAMES])
    create_local_tables()
    ensure_access_key_schema(engine)
    ensure_catalog_schema(engine)
    resource_governor.start(engine)
    with Session(engine) as session:
        seed_defaults(session)
    seed_known_games(engine)
    from .viking_cache_routes import ensure_viking_schema, recover_interrupted_viking_requests
    ensure_viking_schema(engine)
    recover_interrupted_viking_requests(engine)
    from .viking_chunk_service import recover_interrupted_chunk_jobs
    recover_interrupted_chunk_jobs(local_engine)
    from .telemetry import start_sampler
    start_sampler(local_engine)
    _start_steam_review_importer()
    from .discovery_service import start_maintenance
    start_maintenance()
    from .keep_awake import start as start_keep_awake
    start_keep_awake()


@app.on_event("shutdown")
def stop_discovery_worker():
    from .discovery_service import stop_maintenance
    stop_maintenance()
    from .telemetry import stop_sampler
    stop_sampler()
    from .keep_awake import stop as stop_keep_awake
    stop_keep_awake()
    resource_governor.stop()


@app.get("/admin", response_class=HTMLResponse)
@app.get("/admin-console/", response_class=HTMLResponse)
def admin_home(request: Request):
    _admin_browser_access(request)
    page = Path(__file__).resolve().parents[1] / "admin" / "index.html"
    return HTMLResponse(page.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})


@app.get("/ping", status_code=204)
def ping() -> Response:
    """The smallest answer this server gives: keeps a free Render service awake (keep_awake.py)."""
    return Response(status_code=204)


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
from .steam_owned_routes import router as steam_owned_router
from .premium_routes import router as premium_router
app.include_router(premium_router)
app.include_router(steam_search_router)
app.include_router(resolver_router)
app.include_router(linkvertise_access_router)
app.include_router(discovery_router)
app.include_router(cooptimus_router)
app.include_router(steam_owned_router)

from .request_diagnostics import trace_request
app.middleware("http")(require_active_installation)
app.middleware("http")(trace_request)
for router in (activation_router, access_admin_router, client_error_router, catalog_router, viking_cache_router, viking_chunk_router, admin_dashboard_router):
    app.include_router(router)
