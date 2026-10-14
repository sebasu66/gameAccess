"""Administrator dashboard: connected clients, what each one downloads and the load over time."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import HTMLResponse
from sqlmodel import Session

from .access_service import _admin_activation_access
from .admin_security import _admin_browser_access
from .api_dependencies import get_session
from .telemetry import client_history, clients, overview
from .viking_chunk_service import default_work_dir

router = APIRouter(tags=["Admin dashboard"])


@router.get("/admin/dashboard", response_class=HTMLResponse)
def dashboard_page(request: Request) -> HTMLResponse:
    _admin_browser_access(request)
    page = Path(__file__).resolve().parents[1] / "admin" / "dashboard.html"
    return HTMLResponse(page.read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})


@router.get("/admin/api/overview")
def api_overview(request: Request, response: Response, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    response.headers["Cache-Control"] = "no-store"
    return overview(session, default_work_dir())


@router.get("/admin/api/clients")
def api_clients(request: Request, response: Response, limit: int = Query(default=200, ge=1, le=1000), session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    response.headers["Cache-Control"] = "no-store"
    return {"clients": clients(session, limit)}


@router.get("/admin/api/clients/{installation_id}")
def api_client_history(installation_id: str, request: Request, response: Response, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    response.headers["Cache-Control"] = "no-store"
    return client_history(session, installation_id[:36])
